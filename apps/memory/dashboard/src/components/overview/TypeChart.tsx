import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MEMORY_TYPE_LABELS } from "@/lib/constants";

const CHART_COLORS = [
  "#22c55e",
  "#ef4444",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#a3a3a3",
  "#737373",
  "#3b82f6",
];

interface TypeChartProps {
  byType: Record<string, number>;
}

export function TypeChart({ byType }: TypeChartProps) {
  const data = Object.entries(byType)
    .map(([type, count]) => ({
      name: MEMORY_TYPE_LABELS[type] ?? type,
      count,
      type,
    }))
    .sort((a, b) => b.count - a.count);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">By Type</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No memories yet.
        </CardContent>
      </Card>
    );
  }

  const typeOrder = [
    "WORKING_SOLUTION",
    "GOTCHA",
    "PATTERN",
    "DECISION",
    "FAILURE",
    "PREFERENCE",
    "CONTEXT",
    "SKILL_HINT",
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">By Type</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "#a3a3a3" }} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 12, fill: "#a3a3a3" }}
              width={80}
            />
            <Tooltip
              contentStyle={{
                background: "#1c1c1c",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {data.map((entry) => (
                <Cell
                  key={entry.type}
                  fill={CHART_COLORS[typeOrder.indexOf(entry.type)] ?? "#737373"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
