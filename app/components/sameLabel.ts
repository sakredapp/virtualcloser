/** True when an eyebrow just repeats the title ("Execs" over "Execs"). */
export function sameLabel(eyebrow: string, title: string): boolean {
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ')
  return norm(eyebrow) === norm(title)
}
