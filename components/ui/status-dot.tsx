import { statusColorVar } from '@/lib/ui/status';

export default function StatusDot({ status, className = '' }: { status: string; className?: string }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${className}`}
      style={{ backgroundColor: statusColorVar(status) }}
      aria-label={status}
    />
  );
}
