export function originLabel(
  origin: string | undefined,
  backend: string,
  contacts: { id: string; displayName: string }[],
): string | null {
  if (!origin) return null;
  if (origin === backend) return "Your porch";
  const contact = contacts.find((c) => c.id === origin);
  if (contact && contact.displayName.trim()) return `From ${contact.displayName.trim()}`;
  return `From ${origin}`;
}
