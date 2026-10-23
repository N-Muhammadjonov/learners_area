"use client";

import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand/BrandLogo";

/** The campus is the only page with the left-aligned in-header brand block. */
export function CampusTopbarBrand(){
  const pathname=usePathname();
  if(pathname?.replace(/\/+$/,"")!=="/app")return null;
  return (
    <div data-campus-topbar-brand className="flex shrink-0 items-center gap-2">
      <BrandLogo kind="mark" className="h-11 shrink-0" eager decorative />
      <span className="flex min-w-0 flex-col">
        <strong className="whitespace-nowrap text-[17px] font-bold leading-tight text-white">Learners Area</strong>
        <small className="whitespace-nowrap text-[10px] text-slate-300">Take your learning journey with us</small>
      </span>
    </div>
  );
}
