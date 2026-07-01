export default function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-border rounded-lg p-6 ${className}`}>
      {children}
    </div>
  );
}
