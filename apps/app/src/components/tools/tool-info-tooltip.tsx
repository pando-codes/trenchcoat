"use client";

import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ToolInfoTooltipProps {
  description: string;
}

export function ToolInfoTooltip({ description }: ToolInfoTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="inline-block ml-1.5 size-3.5 text-muted-foreground/60 hover:text-muted-foreground cursor-default shrink-0" />
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-sm">
          {description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
