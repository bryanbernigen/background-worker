-- One-time backfill: recompute run_history.summary for existing DataAnnotation
-- 'ok' runs into the projects/qualifications format (matches lib/jobs/data-annotation
-- formatDaSummary). New runs already write this format; this aligns historical rows.
UPDATE "run_history" rh SET "summary" =
  'projects: '       || COALESCE(rh.data->>'paidProjects','0')       || '/' || COALESCE(rh.data->>'allProjects','0')
    || ' (+' || COALESCE(rh.data->>'newPaidProjects','0')            || '/+' || COALESCE(rh.data->>'newAllProjects','0') || ')' || E'\n'
  || 'qualifications: ' || COALESCE(rh.data->>'paidQualifications','0') || '/' || COALESCE(rh.data->>'allQualifications','0')
    || ' (+' || COALESCE(rh.data->>'newPaidQualifications','0')      || '/+' || COALESCE(rh.data->>'newAllQualifications','0') || ')'
FROM "jobs" j
WHERE rh.job_id = j.id AND j.type = 'data-annotation' AND rh.status = 'ok' AND rh.data IS NOT NULL;
