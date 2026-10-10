"use client";

import { useState } from "react";
import { MapPinMark } from "@/components/Icon";

interface Pin {
  label: string;
  lat: number;
  lng: number;
  href: string;
}

/**
 * Click-to-load map: a light static preview with branch pins (no third-party JS on page load,
 * keeps LCP fast), swapped for the embedded Google map when the visitor asks for it.
 */
export function MapEmbed({ pins, loadLabel, caption, title }: { pins: Pin[]; loadLabel: string; caption: string; title: string }) {
  const [live, setLive] = useState(false);
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const pos = (p: Pin) => ({
    left: `${maxLng === minLng ? 50 : 22 + (56 * (p.lng - minLng)) / (maxLng - minLng)}%`,
    top: `${maxLat === minLat ? 45 : 28 + (40 * (maxLat - p.lat)) / (maxLat - minLat)}%`,
  });
  const center = pins.length ? `${(minLat + maxLat) / 2},${(minLng + maxLng) / 2}` : "30.05,31.4";

  if (live)
    return (
      <div className="map">
        <iframe title={title} src={`https://www.google.com/maps?q=${center}&z=11&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      </div>
    );

  return (
    <div className="map" role="group" aria-label={title}>
      <svg width="100%" height="100%" viewBox="0 0 600 360" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }} aria-hidden="true">
        <path d="M0 120 L600 80 M0 260 L600 300 M150 0 L210 360 M420 0 L380 360 M0 190 Q300 150 600 210" stroke="#FFFFFF" strokeWidth="10" fill="none" />
        <path d="M0 40 L600 20 M80 0 L60 360 M520 0 L560 360" stroke="#D3E2F7" strokeWidth="5" fill="none" />
      </svg>
      {pins.map((p) => (
        <a key={p.label} className="map-pin" href={p.href} target="_blank" rel="noopener" style={{ ...pos(p), transform: "translate(-50%, -50%)" }}>
          <span>{p.label}</span>
          <MapPinMark />
        </a>
      ))}
      <button type="button" className="btn btn-outline" onClick={() => setLive(true)} style={{ position: "absolute", top: 12, insetInlineStart: 12, minHeight: 44 }}>
        {loadLabel}
      </button>
      <div className="map-caption">{caption}</div>
    </div>
  );
}
