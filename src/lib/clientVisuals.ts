const PALETTE = [
  '#3a2a3a', '#2a3a4a', '#4a3a2a', '#2a3a3a', '#3a2a2a',
  '#2a4a4a', '#3a3a3a', '#2a3a2a', '#2a2a3a', '#3a2a4a', '#4a3a3a',
];

export function clientInitials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return '??';
}

export function clientColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
