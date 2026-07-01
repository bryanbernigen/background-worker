export default function Badge({ children, color = 'gray' }: { children: React.ReactNode; color?: 'green' | 'red' | 'gray' | 'blue' | 'orange' | 'yellow' }) {
  const colors = {
    green: 'bg-ok/20 text-ok',
    red: 'bg-error/20 text-error',
    gray: 'bg-off/20 text-muted',
    blue: 'bg-accent/20 text-accent',
    orange: 'bg-warn/20 text-warn',
    yellow: 'bg-warn/20 text-warn',
  };
  return (
    <span className={`inline-block px-2 py-1 rounded text-sm font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}
