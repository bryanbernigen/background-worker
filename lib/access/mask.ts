import type { Role } from './role';

export function maskName(name: string): string {
  const n = name.trim();
  if (n.length <= 2) return '*'.repeat(Math.max(n.length, 1));
  return `${n[0]}${'*'.repeat(n.length - 2)}${n[n.length - 1]}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '*'.repeat(Math.max(digits.length, 1));
  return `••••${digits.slice(-4)}`;
}

export function maskRecipient<T extends { name: string; phone: string }>(role: Role, r: T): T {
  if (role === 'admin') return r;
  return { ...r, name: maskName(r.name), phone: maskPhone(r.phone) };
}

export function maskRunDetail<T extends Record<string, unknown>>(role: Role, row: T): Partial<T> {
  if (role === 'admin') return row;
  const rest = { ...row };
  delete (rest as Record<string, unknown>).data;
  delete (rest as Record<string, unknown>).rawHtml;
  delete (rest as Record<string, unknown>).errorMessage;
  return rest;
}

export function maskJobCustom(role: Role, custom: unknown): unknown {
  return role === 'admin' ? custom : undefined;
}
