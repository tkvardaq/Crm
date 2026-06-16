"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

interface Lead {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

interface Deal {
  id: string;
  title: string;
  value: number;
  leadId: string;
  pipelineStageId: string;
  expectedCloseDate: Date | null;
  notes: string | null;
  lead: Lead;
}

interface Stage {
  id: string;
  name: string;
  sortOrder: number;
  deals: Deal[];
}

const statusColors: Record<string, string> = {
  New: "bg-slate-100 text-slate-700",
  Qualified: "bg-blue-100 text-blue-700",
  Negotiation: "bg-amber-100 text-amber-700",
  "Closed Won": "bg-emerald-100 text-emerald-700",
  "Closed Lost": "bg-red-100 text-red-700",
};

function DealCard({ deal, onClick }: { deal: Deal; onClick: (deal: Deal) => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: deal.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onClick(deal);
      }}
      className="bg-white rounded-lg p-3 shadow-sm border border-slate-200 cursor-grab hover:shadow-md hover:border-blue-300 transition-all active:cursor-grabbing"
    >
      <div className="flex items-start justify-between">
        <p className="font-medium text-slate-800 text-sm leading-tight">{deal.title}</p>
        <span className="text-slate-300 hover:text-blue-500 ml-1 text-xs">&#9998;</span>
      </div>
      <p className="text-xs text-slate-500 mt-0.5">
        {deal.lead?.firstName} {deal.lead?.lastName}
      </p>
      <p className="text-emerald-600 text-sm font-medium mt-1">
        ${deal.value.toLocaleString()}
      </p>
       {deal.expectedCloseDate && (
         <p className="text-xs text-slate-400 mt-0.5">
           Close: {new Date(deal.expectedCloseDate).toLocaleDateString()}
         </p>
       )}
    </div>
  );
}

function StageColumn({
  stage,
  onAddDeal,
  addingToStage,
  newDealTitle,
  setNewDealTitle,
  newDealValue,
  setNewDealValue,
  newDealEmail,
  setNewDealEmail,
  addingDealLoading,
  onAddDealSubmit,
  onDealClick,
}: {
  stage: Stage;
  onAddDeal: (id: string | null) => void;
  addingToStage: string | null;
  newDealTitle: string;
  setNewDealTitle: (v: string) => void;
  newDealValue: string;
  setNewDealValue: (v: string) => void;
  newDealEmail: string;
  setNewDealEmail: (v: string) => void;
  addingDealLoading: boolean;
  onAddDealSubmit: (stageId: string) => void;
  onDealClick: (deal: Deal) => void;
}) {
  return (
    <div className="w-80 flex-shrink-0 rounded-xl flex flex-col bg-slate-100">
      <div className="p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-700">{stage.name}</h3>
          <span className="bg-white text-slate-500 text-xs px-2 py-0.5 rounded-full">
            {stage.deals.length}
          </span>
        </div>
        <span className="text-sm font-medium text-slate-500">
          ${stage.deals.reduce((s, d) => s + d.value, 0).toLocaleString()}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
        <SortableContext items={stage.deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {stage.deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} onClick={onDealClick} />
          ))}
        </SortableContext>

        {addingToStage === stage.id ? (
          <div className="bg-white rounded-lg p-3 border border-blue-300 space-y-2">
            <input
              type="text"
              placeholder="Deal title"
              value={newDealTitle}
              onChange={(e) => setNewDealTitle(e.target.value)}
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
            <input
              type="email"
              placeholder="Lead email"
              value={newDealEmail}
              onChange={(e) => setNewDealEmail(e.target.value)}
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="number"
              placeholder="Value"
              value={newDealValue}
              onChange={(e) => setNewDealValue(e.target.value)}
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => onAddDealSubmit(stage.id)}
                disabled={addingDealLoading}
                className="flex-1 bg-blue-600 text-white text-xs px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {addingDealLoading ? "..." : "Add"}
              </button>
              <button
                onClick={() => onAddDeal(null)}
                className="flex-1 bg-slate-200 text-slate-700 text-xs px-3 py-1.5 rounded hover:bg-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => onAddDeal(stage.id)}
            className="w-full h-16 rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors text-sm"
          >
            + Add deal
          </button>
        )}
      </div>
    </div>
  );
}

interface StageEdit {
  id: string;
  name: string;
  sortOrder: number;
}

export default function PipelinePage() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDeal, setActiveDeal] = useState<{ deal: Deal; sourceStageId: string } | null>(null);
  const [addingToStage, setAddingToStage] = useState<string | null>(null);
  const [newDealTitle, setNewDealTitle] = useState("");
  const [newDealValue, setNewDealValue] = useState("");
  const [newDealEmail, setNewDealEmail] = useState("");
  const [addingDealLoading, setAddingDealLoading] = useState(false);

  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editCloseDate, setEditCloseDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [stageEdits, setStageEdits] = useState<StageEdit[]>([]);
  const [newStageName, setNewStageName] = useState("");
  const [newStageSort, setNewStageSort] = useState("");
  const [stageModalLoading, setStageModalLoading] = useState(false);
  const [stageError, setStageError] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const fetchStages = useCallback(async () => {
    try {
      const [stagesRes, dealsRes] = await Promise.all([
        fetch("/api/pipeline-stages", { credentials: "include" }),
        fetch("/api/deals", { credentials: "include" }),
      ]);
      if (!stagesRes.ok || !dealsRes.ok) return;

      const stagesData = await stagesRes.json();
      const dealsData: Deal[] = await dealsRes.json();

      const stagesWithDeals: Stage[] = stagesData.map((stage: any) => ({
        ...stage,
        deals: dealsData.filter((d: Deal) => d.pipelineStageId === stage.id),
      }));

      setStages(stagesWithDeals);
    } catch (err) {
      console.error("Failed to fetch pipeline:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStages();
  }, [fetchStages]);

  const handleDragStart = (event: DragStartEvent) => {
    const dealId = String(event.active.id);
    for (const stage of stages) {
      const deal = stage.deals.find((d) => d.id === dealId);
      if (deal) {
        setActiveDeal({ deal, sourceStageId: stage.id });
        break;
      }
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const dealId = String(event.active.id);
    const overId = String(event.over?.id);

    if (!activeDeal || !overId) {
      setActiveDeal(null);
      return;
    }

    let targetStage = stages.find((s) => s.id === overId);
    if (!targetStage) {
      const overDeal = stages.flatMap((s) => s.deals).find((d) => d.id === overId);
      if (overDeal) targetStage = stages.find((s) => s.id === overDeal.pipelineStageId);
    }
    if (!targetStage || activeDeal.sourceStageId === targetStage.id) {
      setActiveDeal(null);
      return;
    }

    const sourceStageId = activeDeal.sourceStageId;
    const targetStageId = targetStage.id;
    setStages((prev) => {
      const deal = activeDeal.deal;
      return prev.map((stage) => {
        if (stage.id === sourceStageId) {
          return { ...stage, deals: stage.deals.filter((d) => d.id !== deal.id) };
        }
        if (stage.id === targetStageId) {
          return { ...stage, deals: [...stage.deals, { ...deal, pipelineStageId: targetStageId }] };
        }
        return stage;
      });
    });

    setActiveDeal(null);

    try {
      await fetch(`/api/deals/${dealId}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ destinationStageId: targetStageId, sourceStageId }),
      });
    } catch (err) {
      console.error("Failed to move deal:", err);
      fetchStages();
    }
  };

  const handleAddDealSubmit = async (stageId: string) => {
    if (!newDealTitle.trim() || !newDealEmail.trim()) return;
    setAddingDealLoading(true);
    try {
      const leadRes = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: newDealEmail }),
      });
      if (!leadRes.ok) throw new Error("Failed to create lead");
      const lead: Lead = await leadRes.json();

      const dealRes = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          leadId: lead.id,
          pipelineStageId: stageId,
          title: newDealTitle,
          value: Number(newDealValue) || 0,
        }),
      });
      if (!dealRes.ok) throw new Error("Failed to create deal");
      const deal: Deal = await dealRes.json();

      setStages((prev) =>
        prev.map((s) => {
          if (s.id !== stageId) return s;
          return { ...s, deals: [...s.deals, { ...deal, lead }] };
        })
      );
      setNewDealTitle("");
      setNewDealValue("");
      setNewDealEmail("");
      setAddingToStage(null);
    } catch (err) {
      console.error("Failed to add deal:", err);
    } finally {
      setAddingDealLoading(false);
    }
  };

  const openEditModal = (deal: Deal) => {
    setEditingDeal(deal);
    setEditTitle(deal.title);
    setEditValue(String(deal.value));
    setEditCloseDate(deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toISOString().split("T")[0] : "");
    setEditNotes(deal.notes || "");
  };

  const closeEditModal = () => {
    setEditingDeal(null);
    setEditTitle("");
    setEditValue("");
    setEditCloseDate("");
    setEditNotes("");
  };

  const handleSaveDeal = async () => {
    if (!editingDeal || !editTitle.trim()) return;
    setEditLoading(true);
    try {
      const res = await fetch(`/api/deals/${editingDeal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: editTitle,
          value: Number(editValue) || 0,
          expectedCloseDate: editCloseDate || null,
          notes: editNotes || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update deal");
      closeEditModal();
      fetchStages();
    } catch (err) {
      console.error("Failed to save deal:", err);
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteDeal = async () => {
    if (!editingDeal) return;
    if (!confirm("Are you sure you want to delete this deal?")) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/deals/${editingDeal.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete deal");
      closeEditModal();
      fetchStages();
    } catch (err) {
      console.error("Failed to delete deal:", err);
    } finally {
      setDeleteLoading(false);
    }
  };

  const openStageModal = () => {
    setStageEdits(stages.map((s) => ({ id: s.id, name: s.name, sortOrder: s.sortOrder })));
    setNewStageName("");
    setNewStageSort("");
    setStageError("");
    setStageModalOpen(true);
  };

  const handleSaveStages = async () => {
    setStageModalLoading(true);
    setStageError("");
    try {
      const patchPromises = stageEdits.map((se) =>
        fetch(`/api/pipeline-stages/${se.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name: se.name, sortOrder: se.sortOrder }),
        })
      );
      const results = await Promise.all(patchPromises);
      const failed = results.find((r) => !r.ok);
      if (failed) throw new Error("Failed to update one or more stages");
      await fetchStages();
      setStageModalOpen(false);
    } catch (err: any) {
      setStageError(err.message || "Failed to save stages");
    } finally {
      setStageModalLoading(false);
    }
  };

  const handleDeleteStage = async (stageId: string) => {
    try {
      const res = await fetch(`/api/pipeline-stages/${stageId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.status === 409) {
        setStageError("Cannot delete stage with existing deals. Move or delete the deals first.");
        return;
      }
      if (!res.ok) throw new Error("Failed to delete stage");
      setStageEdits((prev) => prev.filter((s) => s.id !== stageId));
      fetchStages();
    } catch (err: any) {
      setStageError(err.message || "Failed to delete stage");
    }
  };

  const handleAddStage = async () => {
    if (!newStageName.trim()) return;
    setStageModalLoading(true);
    setStageError("");
    try {
      const res = await fetch("/api/pipeline-stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: newStageName,
          sortOrder: Number(newStageSort) || 0,
        }),
      });
      if (!res.ok) throw new Error("Failed to create stage");
      const created = await res.json();
      setStageEdits((prev) => [...prev, { id: created.id, name: created.name, sortOrder: created.sortOrder }]);
      setNewStageName("");
      setNewStageSort("");
      fetchStages();
    } catch (err: any) {
      setStageError(err.message || "Failed to add stage");
    } finally {
      setStageModalLoading(false);
    }
  };

  const totalValue = stages
    .filter((s) => s.name !== "Closed Lost")
    .reduce((sum, s) => sum + s.deals.reduce((s2, d) => s2 + d.value, 0), 0);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-slate-500">Loading pipeline...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pipeline</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Total Value:{" "}
            <span className="font-semibold text-emerald-600">
              ${totalValue.toLocaleString()}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openStageModal}
            className="border border-slate-300 hover:border-slate-400 text-slate-700 hover:text-slate-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <span>&#9881;</span> Manage Stages
          </button>
          <button
            onClick={() => setAddingToStage(stages[0]?.id || null)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + Add Deal
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto p-6">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 h-full min-w-max">
            {stages.map((stage) => (
              <div key={stage.id} id={stage.id} className="w-80 flex-shrink-0">
                <StageColumn
                  stage={stage}
                  onAddDeal={setAddingToStage}
                  addingToStage={addingToStage}
                  newDealTitle={newDealTitle}
                  setNewDealTitle={setNewDealTitle}
                  newDealValue={newDealValue}
                  setNewDealValue={setNewDealValue}
                  newDealEmail={newDealEmail}
                  setNewDealEmail={setNewDealEmail}
                  addingDealLoading={addingDealLoading}
                  onAddDealSubmit={handleAddDealSubmit}
                  onDealClick={openEditModal}
                />
              </div>
            ))}
          </div>

          <DragOverlay>
            {activeDeal ? (
              <div className="bg-white rounded-lg p-3 shadow-lg border border-blue-300 rotate-2">
                <p className="font-medium text-slate-800 text-sm">{activeDeal.deal.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {activeDeal.deal.lead?.firstName} {activeDeal.deal.lead?.lastName}
                </p>
                <p className="text-emerald-600 text-sm font-medium mt-1">
                  ${activeDeal.deal.value.toLocaleString()}
                </p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {editingDeal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={closeEditModal}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-slate-900 mb-4">Edit Deal</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Value ($)</label>
                <input
                  type="number"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Expected Close Date</label>
                <input
                  type="date"
                  value={editCloseDate}
                  onChange={(e) => setEditCloseDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={handleDeleteDeal}
                  disabled={deleteLoading}
                  className="text-red-600 hover:text-red-700 text-sm font-medium hover:underline disabled:opacity-50"
                >
                  {deleteLoading ? "Deleting..." : "Delete Deal"}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={closeEditModal}
                    className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveDeal}
                    disabled={editLoading || !editTitle.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {editLoading ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {stageModalOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setStageModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-slate-900 mb-4">Manage Stages</h2>
            {stageError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">
                {stageError}
              </div>
            )}
            <div className="space-y-3">
              {stageEdits.map((se, idx) => (
                <div key={se.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={se.name}
                    onChange={(e) => {
                      const next = [...stageEdits];
                      next[idx] = { ...next[idx], name: e.target.value };
                      setStageEdits(next);
                    }}
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    value={se.sortOrder}
                    onChange={(e) => {
                      const next = [...stageEdits];
                      next[idx] = { ...next[idx], sortOrder: Number(e.target.value) || 0 };
                      setStageEdits(next);
                    }}
                    className="w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => handleDeleteStage(se.id)}
                    className="text-red-500 hover:text-red-700 text-sm font-medium px-2 py-1 hover:bg-red-50 rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
              ))}
              <div className="border-t border-slate-200 pt-3 mt-3">
                <p className="text-sm font-medium text-slate-700 mb-2">Add New Stage</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Stage name"
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    placeholder="Order"
                    value={newStageSort}
                    onChange={(e) => setNewStageSort(e.target.value)}
                    className="w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleAddStage}
                    disabled={stageModalLoading || !newStageName.trim()}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-2 rounded-lg disabled:opacity-50 transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6 border-t border-slate-200 pt-4">
              <button
                onClick={() => setStageModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleSaveStages}
                disabled={stageModalLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {stageModalLoading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
