"use client"

import * as React from "react"

// Lightweight no-dependency tooltip fallbacks to avoid runtime import errors.
// These components simply render children and ignore portal logic.
// If richer tooltips are needed, install @radix-ui/react-tooltip and replace.

type PropsWithChildren = { children?: React.ReactNode }

function TooltipProvider({ children }: PropsWithChildren) { return <>{children}</> }

function Tooltip({ children }: PropsWithChildren) { return <>{children}</> }

function TooltipTrigger({ children }: PropsWithChildren) { return <>{children}</> }

function TooltipContent(_props: React.HTMLAttributes<HTMLDivElement>) { return null }

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
