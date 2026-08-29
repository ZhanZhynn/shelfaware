"use client";

import { useState } from "react";
import { SupplierOrderQueue } from "./SupplierOrderQueue";
import { SourcingRequestQueue } from "./SourcingRequestQueue";

type Task = "quotes" | "to-order" | "to-ship";

export function SourcingWorkQueue({
  workspaceId,
  basePath,
  cases,
  supplierOrders,
}: {
  workspaceId: string;
  basePath: string;
  cases: any[];
  supplierOrders: any[];
}) {
  const [task, setTask] = useState<Task>("quotes");
  const quoteCases = cases.filter((item) =>
    ["sourcing", "changes_requested"].includes(item.stage),
  );
  const toOrder = supplierOrders.filter((order) => order.status === "approved");
  const toShip = supplierOrders.filter((order) => order.status === "ordered");
  const tabs: Array<{ id: Task; label: string; count: number; unit: string }> = [
    { id: "quotes", label: "Quotes", count: quoteCases.length, unit: "request" },
    { id: "to-order", label: "To Order", count: toOrder.length, unit: "PO" },
    { id: "to-ship", label: "To Ship", count: toShip.length, unit: "PO" },
  ];

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b">
        <h2 className="mr-auto text-lg font-semibold">My Work</h2>
        <div className="flex flex-wrap gap-x-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTask(tab.id)}
              className={`border-b-2 px-1 pb-3 text-sm font-medium ${
                task === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>
      {task === "quotes" ? (
        <SourcingRequestQueue cases={quoteCases} basePath={basePath} mode="quotes" />
      ) : (
        <SupplierOrderQueue
          workspaceId={workspaceId}
          basePath={basePath}
          taskStatus={task === "to-order" ? "approved" : "ordered"}
        />
      )}
    </section>
  );
}
