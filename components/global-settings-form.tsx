'use client';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/card';
import Button from '@/components/ui/button';

interface AppSettings {
  timezoneOffset: number;
  dayStartHour: number;
  dayEndHour: number;
}

export default function GlobalSettingsForm() {
  const [settings, setSettings] = useState<AppSettings>({ timezoneOffset: 7, dayStartHour: 7, dayEndHour: 23 });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings/app')
      .then(r => r.json())
      .then(d => setSettings(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    const res = await fetch('/api/settings/app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-lg font-semibold mb-4">Time Window</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone Offset (hours from UTC)</label>
            <input
              type="number"
              value={settings.timezoneOffset}
              onChange={e => setSettings(s => ({ ...s, timezoneOffset: parseInt(e.target.value, 10) }))}
              className="w-32 px-3 py-2 border border-gray-300 rounded-md"
              min={-12} max={14}
            />
            <p className="text-xs text-gray-500 mt-1">WIB=7, WITA=8, WIT=9, UTC=0</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Hour (e.g. 7 = 7AM)</label>
              <input
                type="number"
                value={settings.dayStartHour}
                onChange={e => setSettings(s => ({ ...s, dayStartHour: parseInt(e.target.value, 10) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                min={0} max={23}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Hour (e.g. 23 = 11PM)</label>
              <input
                type="number"
                value={settings.dayEndHour}
                onChange={e => setSettings(s => ({ ...s, dayEndHour: parseInt(e.target.value, 10) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                min={0} max={23}
              />
            </div>
          </div>
          <div>
            <Button onClick={save} className="bg-blue-600 text-white hover:bg-blue-700">
              {saved ? 'Saved!' : 'Save Settings'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
