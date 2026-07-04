"use client";

import ShopeeNotificationSettings from "@/components/shopee/ShopeeNotificationSettings";

export default function NotificationSettingsContent() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notification Settings</h1>
        <p className="text-muted-foreground">
          Configure Telegram notifications for SLA alerts and order updates.
        </p>
      </div>
      <ShopeeNotificationSettings />
    </div>
  );
}
