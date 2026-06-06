'use client';

import type { ChatConversacionListItem } from './queries';
import type { Turn } from './schema';
import { Archive, Loader2, MessageSquarePlus, PanelLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/shared/ui/sheet';

import { archiveChatConversacionAction } from './actions';
import { AsistenteChat } from './asistente-client';

/**
 * T-126 · Shell del asistente: sidebar de conversaciones + chat.
 *
 * URL-driven (reload-safe): abrir una conversación es navegar a `?c=<id>` (un
 * `<Link>`), que re-corre el server component y carga sus mensajes; "Nueva"
 * navega a `/asistente`. El chat se remonta por `key={activeConversacionId}` al
 * cambiar de conversación, re-sembrando su estado desde los props del server.
 */
export function AsistenteShell({
  conversaciones,
  activeConversacionId,
  initialMessages,
}: {
  conversaciones: ChatConversacionListItem[];
  activeConversacionId: string | null;
  initialMessages: Turn[];
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const list = (
    <ConversacionList
      conversaciones={conversaciones}
      activeConversacionId={activeConversacionId}
      onNavigate={() => setSheetOpen(false)}
    />
  );

  return (
    <div className="flex gap-4">
      <aside className="hidden w-64 shrink-0 md:block">{list}</aside>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="md:hidden">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <PanelLeft className="mr-2 h-4 w-4" aria-hidden />
                Conversaciones
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Conversaciones</SheetTitle>
              </SheetHeader>
              <div className="px-4 pb-4">{list}</div>
            </SheetContent>
          </Sheet>
        </div>

        <AsistenteChat
          key={activeConversacionId ?? 'new'}
          initialMessages={initialMessages}
          initialConversacionId={activeConversacionId}
        />
      </div>
    </div>
  );
}

function ConversacionList({
  conversaciones,
  activeConversacionId,
  onNavigate,
}: {
  conversaciones: ChatConversacionListItem[];
  activeConversacionId: string | null;
  onNavigate: () => void;
}) {
  return (
    <div className="space-y-2">
      <Button asChild size="sm" className="w-full justify-start">
        <Link href="/asistente" onClick={onNavigate}>
          <MessageSquarePlus className="mr-2 h-4 w-4" aria-hidden />
          Nueva conversación
        </Link>
      </Button>
      <nav className="space-y-1" aria-label="Conversaciones guardadas">
        {conversaciones.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            Todavía no tenés conversaciones guardadas.
          </p>
        ) : (
          conversaciones.map((c) => (
            <ConversacionItem
              key={c.id}
              conversacion={c}
              active={c.id === activeConversacionId}
              onNavigate={onNavigate}
            />
          ))
        )}
      </nav>
    </div>
  );
}

function ConversacionItem({
  conversacion,
  active,
  onNavigate,
}: {
  conversacion: ChatConversacionListItem;
  active: boolean;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const [archiving, setArchiving] = useState(false);

  async function onArchive() {
    setArchiving(true);
    const res = await archiveChatConversacionAction(conversacion.id);
    if (!res.ok) {
      setArchiving(false);
      toast.error('No se pudo archivar', { description: res.message });
      return;
    }
    // Si archivamos la conversación abierta, volvemos a una nueva; si no, refrescamos
    // la lista (el revalidatePath del action marca el cache stale).
    if (active) router.push('/asistente');
    else router.refresh();
  }

  return (
    <div className={cn('group flex items-center gap-1 rounded-md', active && 'bg-muted')}>
      <Link
        href={`/asistente?c=${conversacion.id}`}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'min-w-0 flex-1 truncate rounded-md px-2 py-2 text-sm hover:bg-muted',
          active && 'font-medium',
        )}
      >
        {conversacion.titulo}
      </Link>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => void onArchive()}
        disabled={archiving}
        aria-label={`Archivar conversación: ${conversacion.titulo}`}
      >
        {archiving ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Archive className="h-4 w-4" aria-hidden />
        )}
      </Button>
    </div>
  );
}
