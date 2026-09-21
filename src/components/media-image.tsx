"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { loadMedia } from "@/lib/mirro/db";
import type { MediaRef } from "@/lib/mirro/types";

export function MediaImage({ media, alt, className = "object-cover", contain = false }: { media: MediaRef; alt: string; className?: string; contain?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    loadMedia(media.key).then((blob) => {
      if (!blob || !active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.key]);

  if (!url) return <div className="absolute inset-0 animate-pulse bg-[var(--surface-2)] motion-reduce:animate-none" aria-hidden="true" />;
  return <Image src={url} alt={alt} fill unoptimized sizes="(max-width: 768px) 100vw, 50vw" className={contain ? "object-contain" : className} />;
}
