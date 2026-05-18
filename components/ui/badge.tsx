export default function Badge({ children, color = 'gray' }: { children: React.ReactNode; color?: 'green' | 'red' | 'gray' | 'blue' | 'orange' | 'yellow' }) {
  const colors = {
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    gray: 'bg-gray-100 text-gray-800',
    blue: 'bg-blue-100 text-blue-800',
    orange: 'bg-orange-100 text-orange-800',
    yellow: 'bg-yellow-100 text-yellow-800',
  };
  return (
    <span className={`inline-block px-2 py-1 rounded text-sm font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}
