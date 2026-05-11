'use client';

import { ChevronDown, KeyRound, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useTransition } from 'react';

import { signOutAction } from '@/shared/auth/actions';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';

type AppUserMenuProps = {
  email: string;
};

export function AppUserMenu({ email }: AppUserMenuProps) {
  const [isPending, startTransition] = useTransition();

  const initials = getInitials(email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-label={`Menú de cuenta de ${email}`}
          className="h-auto w-full justify-start gap-2 px-2 py-2 text-left"
          disabled={isPending}
        >
          <Avatar size="sm">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="flex-1 truncate text-sm">{email}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/cambiar-password">
            <KeyRound />
            Cambiar contraseña
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            // Evitar que el dropdown se cierre antes de que la action se
            // dispare — el redirect lo hace Next.js cuando la response llega.
            event.preventDefault();
            startTransition(() => {
              void signOutAction();
            });
          }}
          disabled={isPending}
        >
          <LogOut />
          {isPending ? 'Cerrando sesión…' : 'Cerrar sesión'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getInitials(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[.\-_+]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? local[0] ?? '?';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}
