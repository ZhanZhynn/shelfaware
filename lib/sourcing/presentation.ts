export type SourcingViewer = "admin" | "sourcer";

export type SourcingPresentationGroup =
  | "needs_action"
  | "waiting"
  | "to_ship"
  | "shipped"
  | "completed"
  | "closed";

export type SourcingBadgeVariant =
  | "secondary"
  | "warning"
  | "info"
  | "success"
  | "destructive";

type TimelineStep = { id: string; label: string };

const ADMIN_STAGE_TO_GROUP: Record<string, SourcingPresentationGroup> = {
  draft: "needs_action",
  sourcing: "waiting",
  changes_requested: "waiting",
  quoted: "needs_action",
  approved: "needs_action",
  ordered: "waiting",
  shipping: "waiting",
  received: "completed",
  rejected: "closed",
  cannot_source: "closed",
  cancelled: "closed",
  archived: "closed",
};

const SOURCER_STAGE_TO_GROUP: Record<string, SourcingPresentationGroup> = {
  draft: "needs_action",
  sourcing: "needs_action",
  changes_requested: "needs_action",
  quoted: "waiting",
  approved: "waiting",
  ordered: "needs_action",
  shipping: "shipped",
  received: "completed",
  rejected: "closed",
  cannot_source: "closed",
  cancelled: "closed",
  archived: "closed",
};

const ADMIN_TIMELINE: TimelineStep[] = [
  { id: "draft", label: "Request" },
  { id: "sourcing", label: "Sourcing" },
  { id: "quoted", label: "Review" },
  { id: "approved", label: "Approved" },
  { id: "ordered", label: "Ordered" },
  { id: "shipping", label: "Shipping" },
  { id: "received", label: "Received" },
];

const SOURCER_TIMELINE: TimelineStep[] = [
  { id: "draft", label: "Request" },
  { id: "sourcing", label: "Sourcing" },
  { id: "quoted", label: "Awaiting approval" },
  { id: "ordered", label: "To ship" },
  { id: "shipping", label: "Shipped" },
  { id: "received", label: "Received" },
];

const ADMIN_TIMELINE_INDEX: Record<string, number> = {
  draft: 0,
  sourcing: 1,
  changes_requested: 1,
  quoted: 2,
  approved: 3,
  ordered: 4,
  shipping: 5,
  received: 6,
};

const SOURCER_TIMELINE_INDEX: Record<string, number> = {
  draft: 0,
  sourcing: 1,
  changes_requested: 1,
  quoted: 2,
  approved: 2,
  ordered: 3,
  shipping: 4,
  received: 5,
};

export function getSourcingGroup(
  stage: string,
  viewer: SourcingViewer,
): SourcingPresentationGroup {
  const groups = viewer === "admin" ? ADMIN_STAGE_TO_GROUP : SOURCER_STAGE_TO_GROUP;
  return groups[stage] ?? "needs_action";
}

export function getSourcingStatusMessage(
  stage: string,
  viewer: SourcingViewer,
  assigneeName?: string | null,
) {
  const sourcer = assigneeName || "the assigned sourcer";
  const messages: Record<SourcingViewer, Record<string, string>> = {
    admin: {
      draft: "Your action: assign a sourcer",
      sourcing: `Waiting on ${sourcer} to submit offers`,
      changes_requested: `Waiting on ${sourcer} to revise the offer`,
      quoted: "Your action: review submitted offers",
      approved: "Your action: confirm the order",
      ordered: `Waiting on ${sourcer} to arrange shipment`,
      shipping: "Awaiting receipt through Receiving",
      received: "Order received",
      rejected: "Request rejected",
      cannot_source: "Cannot source",
      cancelled: "Request cancelled",
      archived: "Request archived",
    },
    sourcer: {
      draft: "Your action: complete the request",
      sourcing: "Your action: source and submit offers",
      changes_requested: "Your action: revise and resubmit",
      quoted: "Waiting for admin approval",
      approved: "Waiting for admin to place the order",
      ordered: "Your action: arrange shipment",
      shipping: "Shipped, awaiting receipt",
      received: "Order received",
      rejected: "Request rejected",
      cannot_source: "Cannot source",
      cancelled: "Request cancelled",
      archived: "Request archived",
    },
  };
  return messages[viewer][stage] ?? "Follow up";
}

export function getSourcingStageBadgeVariant(
  stage: string,
): SourcingBadgeVariant {
  const variants: Record<string, SourcingBadgeVariant> = {
    draft: "secondary",
    sourcing: "warning",
    changes_requested: "warning",
    quoted: "info",
    approved: "success",
    ordered: "info",
    shipping: "warning",
    received: "success",
    rejected: "destructive",
    cannot_source: "destructive",
    cancelled: "secondary",
    archived: "secondary",
  };
  return variants[stage] ?? "secondary";
}

export function getSourcingTimeline(viewer: SourcingViewer) {
  return viewer === "admin" ? ADMIN_TIMELINE : SOURCER_TIMELINE;
}

export function getSourcingTimelineIndex(
  stage: string,
  viewer: SourcingViewer,
) {
  const indexes = viewer === "admin" ? ADMIN_TIMELINE_INDEX : SOURCER_TIMELINE_INDEX;
  return indexes[stage] ?? -1;
}
