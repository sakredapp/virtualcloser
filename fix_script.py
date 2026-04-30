import sys
path = '/Users/sakredbody22/virtualcloser/app/dashboard/dialer/appointment-setter/[id]/SalespersonEditor.tsx'
lines = open(path).readlines()
target = "r.name ?? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '—'"
replacement = "(r.name ?? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()) || '—'"
lines[697] = lines[697].replace(target, replacement)
with open(path, 'w') as f:
    f.writelines(lines)
