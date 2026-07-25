"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSourcingSlaSettings, useUpdateSourcingSlaSettings } from "@/hooks/queries";

const initialConfig = {
  timezone: "UTC",
  businessHours: { start: "09:00", end: "17:00", weekdays: [1, 2, 3, 4, 5] },
  rules: { first_response: 8, quote_submission: 24, approval: 16, shipment: 48 },
  escalation: { thresholdHours: 24, recipientIds: [] as string[] },
};
const weekdays = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;
type Recipient = { userId: string; user?: { name?: string | null; email?: string | null } };
type SettingsResponse = { config: typeof initialConfig; eligibleRecipients: Recipient[] };

export function SourcingSlaSettings({ workspaceId, members }: { workspaceId: string; members: Array<{ userId?: string; id?: string; user?: { name?: string | null; email?: string | null }; name?: string | null; email?: string | null }> }) {
  const { data } = useSourcingSlaSettings(workspaceId);
  const update = useUpdateSourcingSlaSettings();
  const [formConfig, setFormConfig] = useState<typeof initialConfig | null>(null);
  const settings = data as SettingsResponse | undefined;
  const config: typeof initialConfig = formConfig || settings?.config || initialConfig;
  const eligibleRecipients = settings?.eligibleRecipients || members.map((member) => ({ userId: member.userId || member.id || "", user: member.user || { name: member.name, email: member.email } })).filter((member) => member.userId);
  const updateConfig = (update: (current: typeof initialConfig) => typeof initialConfig) => setFormConfig((current) => update(current || config));
  const toggle = (value: number) => updateConfig((current) => ({ ...current, businessHours: { ...current.businessHours, weekdays: current.businessHours.weekdays.includes(value) ? current.businessHours.weekdays.filter((day) => day !== value) : [...current.businessHours.weekdays, value].sort() } }));
  const toggleRecipient = (userId: string) => updateConfig((current) => ({ ...current, escalation: { ...current.escalation, recipientIds: current.escalation.recipientIds.includes(userId) ? current.escalation.recipientIds.filter((id) => id !== userId) : [...current.escalation.recipientIds, userId] } }));
  const ruleLabel: Record<keyof typeof config.rules, string> = { first_response: "First response", quote_submission: "Quote submission", approval: "Approval", shipment: "Shipment" };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Settings className="h-4 w-4 mr-2" />
          SLA Settings
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(560px,100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto space-y-4 text-sm" align="center" side="bottom" sideOffset={8} collisionPadding={16}>
        <p className="font-medium">SLA and escalation settings</p>
        <p className="text-muted-foreground">Deadlines use business hours in this workspace timezone. Existing active deadlines are preserved.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 font-medium">Timezone<Input value={config.timezone} onChange={(event) => updateConfig((current) => ({ ...current, timezone: event.target.value }))} placeholder="Asia/Kuala_Lumpur" /></label>
          <label className="grid gap-1 font-medium">Business start<Input type="time" value={config.businessHours.start} onChange={(event) => updateConfig((current) => ({ ...current, businessHours: { ...current.businessHours, start: event.target.value } }))} /></label>
          <label className="grid gap-1 font-medium">Business end<Input type="time" value={config.businessHours.end} onChange={(event) => updateConfig((current) => ({ ...current, businessHours: { ...current.businessHours, end: event.target.value } }))} /></label>
        </div>
        <fieldset className="flex flex-wrap gap-3"><legend className="mb-1 font-medium">Business days</legend>{weekdays.map(([value, label]) => <label key={value} className="flex items-center gap-1"><input type="checkbox" checked={config.businessHours.weekdays.includes(value)} onChange={() => toggle(value)} />{label}</label>)}</fieldset>
        <div className="grid gap-3 sm:grid-cols-4">{(Object.keys(config.rules) as Array<keyof typeof config.rules>).map((rule) => <label key={rule} className="grid gap-1 font-medium">{ruleLabel[rule]} hours<Input type="number" min="1" max="720" value={config.rules[rule]} onChange={(event) => updateConfig((current) => ({ ...current, rules: { ...current.rules, [rule]: Number(event.target.value) } }))} /></label>)}</div>
        <label className="grid max-w-xs gap-1 font-medium">Escalate after overdue hours<Input type="number" min="0" max="720" value={config.escalation.thresholdHours} onChange={(event) => updateConfig((current) => ({ ...current, escalation: { ...current.escalation, thresholdHours: Number(event.target.value) } }))} /></label>
        <fieldset className="grid gap-2"><legend className="font-medium">Escalation recipients</legend>{eligibleRecipients.map((member) => <label key={member.userId} className="flex items-center gap-2"><input type="checkbox" checked={config.escalation.recipientIds.includes(member.userId)} onChange={() => toggleRecipient(member.userId)} />{member.user?.name || member.user?.email || member.userId}</label>)}</fieldset>
        <Button isLoading={update.isPending} onClick={() => update.mutate({ workspaceId, ...config })}>Save SLA settings</Button>
      </PopoverContent>
    </Popover>
  );
}
