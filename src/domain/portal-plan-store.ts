import { randomUUID } from "node:crypto";
import type { StateStore } from "../infrastructure/json-state-store.js";
import type { PortalPlan } from "./types.js";

function clonePlan(plan: PortalPlan): PortalPlan {
  return JSON.parse(JSON.stringify(plan)) as PortalPlan;
}

export class PortalPlanStore {
  private readonly plans: PortalPlan[];

  public constructor(private readonly stateStore?: StateStore) {
    this.plans = (stateStore?.load<PortalPlan[]>("portal-plans.json", []) ?? []).map(clonePlan);
  }

  public list(): PortalPlan[] {
    return this.plans.map(clonePlan);
  }

  public get(planId: string): PortalPlan | undefined {
    const plan = this.plans.find((candidate) => candidate.id === planId);
    return plan ? clonePlan(plan) : undefined;
  }

  public create(input: Omit<PortalPlan, "id" | "generatedAt">): PortalPlan {
    const plan: PortalPlan = {
      ...input,
      id: `portal-plan-${randomUUID()}`,
      generatedAt: new Date().toISOString(),
    };
    this.plans.push(plan);
    this.persist();
    return clonePlan(plan);
  }

  private persist(): void {
    this.stateStore?.save("portal-plans.json", this.plans);
  }
}
