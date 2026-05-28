'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/shared/ui/accordion';

/**
 * T-108 · FAQ accordion reutilizable para landing + /precios.
 *
 * Client Component (radix accordion necesita JS para open/close + animations).
 * Usa el shadcn accordion canónico copiado en `src/shared/ui/accordion.tsx`.
 *
 * `type="single" collapsible` = sólo un item abierto por vez + permite cerrar
 * el activo (en lugar de mantener siempre uno expandido).
 */

export interface FAQItem {
  q: string;
  a: string;
}

interface FAQAccordionProps {
  items: readonly FAQItem[];
}

export function FAQAccordion({ items }: FAQAccordionProps) {
  return (
    <Accordion type="single" collapsible className="mx-auto w-full max-w-3xl">
      {items.map((item, idx) => (
        <AccordionItem key={item.q} value={`faq-${idx}`}>
          <AccordionTrigger className="text-base">{item.q}</AccordionTrigger>
          <AccordionContent>
            <p className="text-muted-foreground leading-relaxed">{item.a}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
