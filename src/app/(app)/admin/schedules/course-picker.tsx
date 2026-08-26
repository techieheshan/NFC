"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type CourseOption = { id: number; label: string };

/**
 * Searchable course select. A plain <select> becomes unusable once an institute
 * has dozens of courses, so this is a filter-as-you-type combobox that still
 * submits a normal hidden `courseId` field.
 */
export function CoursePicker({
  courses,
  defaultValue,
  name = "courseId",
}: {
  courses: CourseOption[];
  defaultValue?: number;
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<number | null>(defaultValue ?? null);

  const selected = courses.find((c) => c.id === value);

  return (
    <div className="space-y-2">
      <Label htmlFor={`${name}-trigger`}>Course</Label>
      <input type="hidden" name={name} value={value ?? ""} />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={`${name}-trigger`}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected ? selected.label : "Select course…"}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search courses…" />
            <CommandList>
              <CommandEmpty>No course found.</CommandEmpty>
              <CommandGroup>
                {courses.map((course) => (
                  <CommandItem
                    key={course.id}
                    // Searching matches the label, not the numeric id.
                    value={course.label}
                    onSelect={() => {
                      setValue(course.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        course.id === value ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{course.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
