export default function Button({ children, onClick, className = '', type = 'button', disabled = false }: {
  children: React.ReactNode; onClick?: () => void; className?: string; type?: 'button' | 'submit'; disabled?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-md font-medium transition-colors ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}
