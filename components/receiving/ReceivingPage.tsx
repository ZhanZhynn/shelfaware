"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScanLine, History } from "lucide-react";
import ScanToReceivePanel from "./ScanToReceivePanel";
import ReceiveHistoryTable from "./ReceiveHistoryTable";

export default function ReceivingPage() {
  const [tab, setTab] = useState("scan");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Warehouse Receiving</h1>
        <p className="text-muted-foreground">
          Scan product QR/barcodes to receive stock into a warehouse
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="scan" className="flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            Scan to Receive
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Receive History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scan" className="mt-6">
          <ScanToReceivePanel />
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <ReceiveHistoryTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
