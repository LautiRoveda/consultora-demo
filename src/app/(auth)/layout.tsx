import Link from 'next/link';

/**
 * Layout para rutas de autenticación (`/login`, eventual `/signup`,
 * `/recuperar-password`).
 *
 * No declara `<html>` ni `<body>` — eso lo provee el root layout. Solo wrapper
 * visual: fondo plano, contenido centrado, header mínimo con link a home.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 flex min-h-full flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md text-sm font-bold">
              CD
            </span>
            <span className="text-sm font-semibold">ConsultoraDemo</span>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">{children}</main>
    </div>
  );
}
