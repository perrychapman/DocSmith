"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "flex border-b border-[hsl(var(--border))]",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        `relative inline-flex h-10 items-center justify-center px-4 py-2 text-xs font-medium tracking-wide uppercase
         text-[hsl(var(--muted-foreground))] transition-all
         data-[state=active]:text-[hsl(var(--primary))]
         data-[state=active]:after:absolute data-[state=active]:after:bottom-0
         data-[state=active]:after:left-1/2 data-[state=active]:after:-translate-x-1/2
         data-[state=active]:after:h-[2px] data-[state=active]:after:w-8
         data-[state=active]:after:bg-[hsl(var(--primary))]`,
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 p-4", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
