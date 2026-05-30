// app/api/cron/check/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { checkers } from '@/lib/checkers';
import { kvGet, kvSet } from '@/lib/kv';
import { WahaClient } from '@/lib/waha'; // Import WahaClient to send the alert

export const dynamic = 'force-dynamic';

interface AppSettings {
  timezoneOffset: number;
  dayStartHour: number;
  dayEndHour: number;
}

interface CheckRun {
  timestamp: string;
  checkerName: string;
  projectsFound: number;
  qualificationsFound: number;
  paidProjectsFound: number;
  paidQualsFound: number;
  newProjects: number;
  newQualifications: number;
  paidProjectsNew: number;
  paidQualsNew: number;
  errors: string[];
  reason?: string;
  triggerType: 'manual' | 'scheduled';
  diffMs: number;
  debug?: {
    htmlLen: number;
    reportableProjectsInfo: { name: string; pay: string; tasks: string; qual: boolean; paid: boolean }[];
    merchProjects: { name: string; pay: string; tasks: string; qual: boolean; paid: boolean }[];
    merchQuals: { name: string; pay: string; tasks: string; qual: boolean; paid: boolean }[];
    extracted: { name: string; pay: string; tasks: string; qual: boolean; paid: boolean }[];
  };
}

async function getAppSettings(): Promise<AppSettings> {
  const settings = await kvGet<AppSettings>('app_settings');
  return settings ?? { timezoneOffset: 7, dayStartHour: 7, dayEndHour: 23 };
}

function isWithinTimeWindow(settings: AppSettings): boolean {
  const now = new Date();
  const local = new Date(now.getTime() + settings.timezoneOffset * 60 * 60 * 1000);
  const hour = local.getUTCHours();
  return hour >= settings.dayStartHour && hour <= settings.dayEndHour;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function recordHistory(reason: string, triggerType: 'manual' | 'scheduled', diffMs: number, errors: string[] = []) {
  const history = await kvGet<CheckRun[]>('check_history') ?? [];
  const newEntries: CheckRun[] = checkers.map(c => ({
    timestamp: new Date().toISOString(),
    checkerName: c.name,
    projectsFound: 0,
    qualificationsFound: 0,
    paidProjectsFound: 0,
    paidQualsFound: 0,
    newProjects: 0,
    newQualifications: 0,
    paidProjectsNew: 0,
    paidQualsNew: 0,
    errors,
    reason,
    triggerType,
    diffMs,
  }));
  history.unshift(...newEntries);
  await kvSet('check_history', history.slice(0, 100));
}

// Separate helper function to handle the consecutive failure logic cleanly
async function handleFailureTracking(errMessage: string) {
  const FAIL_LIMIT = 3;
  const counterKey = 'consecutive_fail_count';
  
  // 1. Increment failure counter
  const currentFails = await kvGet<number>(counterKey) ?? 0;
  const newFailsCount = currentFails + 1;
  await kvSet(counterKey, newFailsCount);

  // 2. Alert exactly on the 3rd failure (avoids spamming if it continues to fail)
  if (newFailsCount === FAIL_LIMIT) {
    const waRecipient = await kvGet<string>('wa_recipient');
    const wahaUrl = process.env.WAHA_URL;
    const wahaKey = process.env.WAHA_API_KEY ?? '';

    if (waRecipient && wahaUrl) {
      try {
        const waha = new WahaClient(wahaUrl, wahaKey);
        const alertMessage = `⚠️ *Scraper Alert* ⚠️\n\nThe DataAnnotation scraper has failed *${FAIL_LIMIT} times consecutively*.\n\n*Latest Error:*\n${errMessage}\n\n_Please check your browser cookie session state._`;
        await waha.sendText(waRecipient, alertMessage);
      } catch (waErr) {
        console.error('Failed sending failure alert via WAHA:', waErr);
      }
    }
  }
}

export async function GET(req: NextRequest) {
  const triggerType = req.headers.get('x-trigger-type') as 'manual' | 'scheduled' | null;

  if (!triggerType) {
    return new NextResponse('Unauthorized: Request missing validation context.', { status: 401 });
  }

  const isManual = triggerType === 'manual';
  const settings = await getAppSettings();

  const nextMinutes = randomBetween(10, 30);
  const nextRun = new Date(Date.now() + nextMinutes * 60 * 1000);
  await kvSet('next_allowed_run', nextRun.toISOString());

  const lastChecked = await kvGet<string>('last_checked');
  const diffMs = lastChecked ? Date.now() - new Date(lastChecked).getTime() : 0;

  if (!isManual && !isWithinTimeWindow(settings)) {
    await recordHistory('outside_time_window', triggerType, diffMs);
    return NextResponse.json({ message: 'Outside time window' });
  }

  const lockKey = 'cron_lock';
  const lockVal = `locked_${Date.now()}`;
  if (!isManual) {
    const existing = await kvGet<string>(lockKey);
    if (existing) {
      await recordHistory('another_run_in_progress', triggerType, diffMs);
      return NextResponse.json({ message: 'Another run in progress' });
    }
    await kvSet(lockKey, lockVal, 300);
  }

  try {
    const results = [];
    let processingErrorOccurred = false;
    let fallbackErrorMessage = '';

    for (const checker of checkers) {
      try {
        const result = await checker.run();
        results.push(result);
        
        // If the individual checker explicitly returned an operational authentication/scraping error string
        if (result.errors && result.errors.length > 0) {
          processingErrorOccurred = true;
          fallbackErrorMessage = result.errors.join(', ');
        }
      } catch (err) {
        processingErrorOccurred = true;
        fallbackErrorMessage = String(err);
        results.push({
          checkerName: checker.name,
          newItems: [],
          errors: [fallbackErrorMessage],
        });
      }
    }

    // --- SUCCESS vs FAILURE TRACKING GATES ---
    if (processingErrorOccurred) {
      await handleFailureTracking(fallbackErrorMessage);
    } else {
      // Clean run successful -> completely reset consecutive fail counters to 0
      await kvSet('consecutive_fail_count', 0);
    }

    const history = await kvGet<CheckRun[]>('check_history') ?? [];
    
    const newEntries: CheckRun[] = results.map(r => {
      const debug = (r as { debug?: CheckRun['debug'] }).debug;
      const extractedItems = debug?.extracted ?? [];

      const currentProjects = extractedItems.filter(i => !i.qual);
      const currentQuals = extractedItems.filter(i => i.qual);
      const newProjectsList = r.newItems.filter(i => !i.qualification);
      const newQualsList = r.newItems.filter(i => i.qualification);

      return {
        timestamp: new Date().toISOString(),
        checkerName: r.checkerName,
        projectsFound: currentProjects.length,
        paidProjectsFound: currentProjects.filter(i => i.paid).length,
        qualificationsFound: currentQuals.length,
        paidQualsFound: currentQuals.filter(i => i.paid).length,
        newProjects: newProjectsList.length,
        paidProjectsNew: newProjectsList.filter(i => i.pay?.includes('$')).length,
        newQualifications: newQualsList.length,
        paidQualsNew: newQualsList.filter(i => i.pay?.includes('$')).length,
        errors: r.errors,
        triggerType,
        diffMs,
        debug,
      };
    });

    history.unshift(...newEntries);
    await kvSet('check_history', history.slice(0, 100));
    await kvSet('last_checked', new Date().toISOString());

    const firstDebug = (results[0] as { debug?: CheckRun['debug'] }).debug;
    return NextResponse.json({
      message: 'Check completed',
      nextRun: nextRun.toISOString(),
      results,
      debug: firstDebug,
    });
  } catch (err) {
    // Catch-all block for catastrophic failures (e.g., Redis down, code panic)
    await recordHistory('check_failed', triggerType, diffMs, [String(err)]);
    await handleFailureTracking(String(err));
    throw err;
  } finally {
    if (!isManual) {
      await kvSet(lockKey, '', 1);
    }
  }
}