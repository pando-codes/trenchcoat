"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Laptop } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface MachineOption {
  id: string;
  name: string;
}

interface MachineFilterProps {
  machines: MachineOption[];
}

const ALL = "__all__";

/**
 * Global machine/environment filter. Each Trenchcoat API key maps to one
 * machine, so we filter by api_key_id and label by the key's name. Writes an
 * `api_key_id` search param on the current route (like the date picker), so it
 * applies on every dashboard page.
 */
export function MachineFilter({ machines }: MachineFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("api_key_id");

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== ALL) {
      params.set("api_key_id", value);
    } else {
      params.delete("api_key_id");
    }
    params.delete("page");
    router.replace(`?${params.toString()}`);
  }

  // Nothing to filter by until the user has more than one key/machine.
  if (machines.length < 2) return null;

  return (
    <div className="flex items-center gap-2">
      <Laptop className="size-4 text-muted-foreground" />
      <Select value={current ?? ALL} onValueChange={handleChange}>
        <SelectTrigger className="h-9 w-[180px]">
          <SelectValue placeholder="All machines" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All machines</SelectItem>
          {machines.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
