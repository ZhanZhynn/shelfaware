"use client";

import { type ReactNode } from "react";
import {
  type Table as TanStackTable,
  flexRender,
} from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, type LucideIcon } from "lucide-react";
import MarketplacePagination from "./MarketplacePagination";

interface MarketplaceDataTableProps<TData> {
  table: TanStackTable<TData>;
  isLoading?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalCount?: number;
  countLabel?: string;
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  emptyStateIcon?: LucideIcon;
  headerActions?: ReactNode;
  columnCount: number;
}

function MarketplaceDataTableSkeleton({ columnCount }: { columnCount: number }) {
  return (
    <div className="space-y-2 p-4">
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}

function MarketplaceDataTableEmpty({
  title,
  description,
  icon: Icon,
  columnCount,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  columnCount: number;
}) {
  return (
    <TableRow>
      <TableCell colSpan={columnCount} className="h-24 text-center">
        <div className="flex flex-col items-center justify-center">
          {Icon && <Icon className="h-8 w-8 text-muted-foreground mb-2" />}
          <p className="text-sm font-medium">{title}</p>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function MarketplaceDataTable<TData>({
  table,
  isLoading,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  page,
  totalPages,
  onPageChange,
  totalCount,
  countLabel,
  emptyStateTitle = "No results found",
  emptyStateDescription,
  emptyStateIcon,
  headerActions,
  columnCount,
}: MarketplaceDataTableProps<TData>) {
  return (
    <div className="space-y-4">
      {(searchPlaceholder || headerActions) && (
        <div className="flex items-center gap-2">
          {searchPlaceholder && onSearchChange !== undefined && (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={searchValue ?? ""}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
          {totalCount !== undefined && (
            <span className="text-sm text-muted-foreground">
              {totalCount} {countLabel || "items"}
            </span>
          )}
          {headerActions && <div className="ml-auto">{headerActions}</div>}
        </div>
      )}

      <Card className="bg-gradient-to-br from-card to-card/50 backdrop-blur-sm border border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <MarketplaceDataTableSkeleton columnCount={columnCount} />
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length === 0 ? (
                  <MarketplaceDataTableEmpty
                    title={emptyStateTitle}
                    description={emptyStateDescription}
                    icon={emptyStateIcon}
                    columnCount={columnCount}
                  />
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <MarketplacePagination
        page={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </div>
  );
}
