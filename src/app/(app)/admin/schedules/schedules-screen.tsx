"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type {
  ActionState,
  AdditionalRow,
  DateRange,
  ScheduleFilters,
  ScheduleRow,
} from "./actions";
import { AdditionalManager } from "./additional-manager";
import type { CourseOption } from "./course-picker";
import { ScheduleManager } from "./schedule-manager";

type Props = {
  initialSchedules: ScheduleRow[];
  initialAdditional: AdditionalRow[];
  courses: CourseOption[];
  today: string;
  tab: string;
  scheduleFilters: ScheduleFilters;
  dateRange: DateRange;
  timetableFilterUi: React.ReactNode;
  additionalFilterUi: React.ReactNode;
  listSchedules: (filters: ScheduleFilters) => Promise<ScheduleRow[]>;
  listAdditionalClasses: (range: DateRange) => Promise<AdditionalRow[]>;
  createSchedule: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updateSchedule: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  setScheduleActive: (formData: FormData) => Promise<void>;
  createAdditionalClass: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updateAdditionalClass: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  deleteAdditionalClass: (prev: ActionState, formData: FormData) => Promise<ActionState>;
};

/**
 * Two sections over the same timetable data.
 *
 * Filters are searchParams, so applying one is a full server render — which is
 * why each manager is keyed by its filter signature: new props remount it with
 * fresh rows instead of being synced into state by an effect. The active tab is
 * a searchParam too, so filtering doesn't bounce you back to the other section.
 */
export function SchedulesScreen({
  initialSchedules,
  initialAdditional,
  courses,
  today,
  tab,
  scheduleFilters,
  dateRange,
  timetableFilterUi,
  additionalFilterUi,
  listSchedules,
  listAdditionalClasses,
  createSchedule,
  updateSchedule,
  setScheduleActive,
  createAdditionalClass,
  updateAdditionalClass,
  deleteAdditionalClass,
}: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The timetable attendance will be matched against.
        </p>
      </div>

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="weekly">Weekly timetable</TabsTrigger>
          <TabsTrigger value="additional">Additional classes</TabsTrigger>
        </TabsList>

        <TabsContent value="weekly" className="mt-4">
          <ScheduleManager
            key={`s:${JSON.stringify(scheduleFilters)}`}
            initialRows={initialSchedules}
            filterArgs={scheduleFilters}
            courses={courses}
            filters={timetableFilterUi}
            listAction={listSchedules}
            createAction={createSchedule}
            updateAction={updateSchedule}
            toggleAction={setScheduleActive}
          />
        </TabsContent>

        <TabsContent value="additional" className="mt-4">
          <AdditionalManager
            key={`a:${JSON.stringify(dateRange)}`}
            initialRows={initialAdditional}
            filterArgs={dateRange}
            courses={courses}
            filters={additionalFilterUi}
            today={today}
            listAction={listAdditionalClasses}
            createAction={createAdditionalClass}
            updateAction={updateAdditionalClass}
            deleteAction={deleteAdditionalClass}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
