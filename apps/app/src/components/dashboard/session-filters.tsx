"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SessionFiltersProps {
  branches: string[];
  currentBranch: string | null;
}

export function SessionFilters({ branches, currentBranch }: SessionFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleBranchChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "__all__") {
      params.set("branch", value);
    } else {
      params.delete("branch");
    }
    params.set("page", "1");
    router.replace(`/sessions?${params.toString()}`);
  }

  if (branches.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Branch</span>
      <Select value={currentBranch ?? "__all__"} onValueChange={handleBranchChange}>
        <SelectTrigger className="h-8 w-[180px]">
          <SelectValue placeholder="All branches" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All branches</SelectItem>
          {branches.map((b) => (
            <SelectItem key={b} value={b}>
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
