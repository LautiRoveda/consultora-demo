'use client';

import { Search } from 'lucide-react';

import { Input } from '@/shared/ui/input';

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function EmpleadoSearchBox({ value, onChange }: Props) {
  return (
    <div className="relative w-full sm:max-w-sm">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        type="search"
        placeholder="Buscar por apellido, nombre o DNI…"
        className="pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Buscar empleados"
      />
    </div>
  );
}
