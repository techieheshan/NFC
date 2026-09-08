import { createElement } from "react";
import {
  Anchor, Armchair, Bird, Cloud, Coffee, Flower, Flower2, Gem, Leaf, Lightbulb,
  Moon, Mountain, Music, Palette, Rocket, Salad, Sparkles, Star, Sun, Sunset,
  Trees, Waves, Zap, type LucideIcon,
} from "lucide-react";

/**
 * The icons a hall may wear.
 *
 * `Hall.icon` stores one of these KEYS, never a component or a URL: the name
 * survives a rename of the hall, is safe to put in a database, and an unknown
 * key (from an older seed, or a hand-edited row) falls back rather than
 * crashing a screen. Staff recognise a room by its picture at a glance, which
 * is the whole point of the column.
 */
export const HALL_ICONS: Record<string, LucideIcon> = {
  anchor: Anchor,
  armchair: Armchair,
  bird: Bird,
  cloud: Cloud,
  coffee: Coffee,
  flower: Flower,
  "flower-2": Flower2,
  gem: Gem,
  leaf: Leaf,
  lightbulb: Lightbulb,
  moon: Moon,
  mountain: Mountain,
  music: Music,
  palette: Palette,
  rocket: Rocket,
  salad: Salad,
  sparkles: Sparkles,
  star: Star,
  sun: Sun,
  sunset: Sunset,
  trees: Trees,
  waves: Waves,
  zap: Zap,
};

export const HALL_ICON_KEYS = Object.keys(HALL_ICONS);

export const DEFAULT_HALL_ICON = "sparkles";

/** Never throws: a key nobody recognises still renders something. */
export function hallIcon(key: string | null | undefined): LucideIcon {
  return (key && HALL_ICONS[key]) || HALL_ICONS[DEFAULT_HALL_ICON];
}

/**
 * Draw a hall's icon from its key. A component rather than a looked-up
 * reference so callers never create a component during render — the icon for a
 * row changes as the key does, without remounting anything around it.
 */
export function HallIcon({ icon, className }: { icon: string | null | undefined; className?: string }) {
  // createElement, not <Icon />: the component comes from a lookup, and JSX on
  // a locally-bound component reads to the linter as one created during render.
  return createElement(hallIcon(icon), { className, "aria-hidden": true });
}
