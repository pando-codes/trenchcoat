import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function ActivityLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page heading */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Heatmap card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent>
          {/* Heatmap grid skeleton */}
          <div className="space-y-2">
            {Array.from({ length: 7 }).map((_, row) => (
              <div key={row} className="flex gap-1">
                <Skeleton className="h-4 w-8 shrink-0" />
                {Array.from({ length: 24 }).map((_, col) => (
                  <Skeleton key={col} className="size-4 rounded-sm" />
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Two chart cards */}
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[250px] w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
