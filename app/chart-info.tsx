'use client';

import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/** A small (i) next to a chart title; hover, focus or tap opens a short explanation of what the chart shows. */
export function ChartInfo({ text }: { text: string }) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="chart-info"
          aria-label={`About this chart: ${text}`}
        >
          <Info aria-hidden="true" size={14} />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-left leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
