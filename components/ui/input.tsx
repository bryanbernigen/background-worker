export default function Input({ value, onChange, placeholder = '', className = '', type = 'text' }: {
  value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string; className?: string; type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`w-full px-3 py-2 bg-surface-2 border border-border text-text placeholder:text-muted rounded-md focus:outline-none focus:ring-2 focus:ring-accent ${className}`}
    />
  );
}
