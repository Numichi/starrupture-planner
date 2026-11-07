<!--
  BaseList – the bases of the project and the project actions (logic: BaseList.ts).
-->
<template>
  <section>
    <div class="section-head">
      <h2>Bases</h2>
      <span class="muted section-meta">total {{ formatPower(totalPower) }}</span>
    </div>

    <div class="base-list">
      <div
        v-for="b in project.bases"
        :key="b.id"
        class="base-row"
        :class="{ active: b.id === activeBaseId }"
        @click="setActiveBase(b.id)"
      >
        <span class="folder" aria-hidden="true">{{ b.id === activeBaseId ? '📂' : '📁' }}</span>

        <input
          v-if="renaming === b.id"
          ref="renameInput"
          v-model="draft"
          type="text"
          aria-label="Base name"
          @click.stop
          @keydown.enter="finishRename"
          @keydown.esc="renaming = null"
          @blur="finishRename"
        />

        <template v-else>
          <span class="base-name" @dblclick.stop="startRename(b.id, b.name)">{{ b.name }}</span>
          <span class="base-meta">{{ formatPower(basePlans.get(b.id)?.summary.totalPower ?? 0) }}</span>
          <button type="button" class="icon-btn" title="Rename" @click.stop="startRename(b.id, b.name)">
            ✎
          </button>
          <button
            v-if="project.bases.length > 1"
            type="button"
            class="icon-btn"
            title="Delete"
            @click.stop="confirmRemove(b.id, b.name)"
          >
            🗑
          </button>
        </template>
      </div>
    </div>

    <div class="btn-row">
      <button type="button" class="add-btn" @click="addBase">+ New base</button>
      <button type="button" class="link-btn" title="Save the project to a JSON file" @click="download">
        Export
      </button>
      <button
        type="button"
        class="link-btn"
        title="Load a project from a JSON file"
        @click="fileInput?.click()"
      >
        Import
      </button>
      <button type="button" class="link-btn" @click="newProject">New project</button>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onFile" />
    </div>

    <p class="hint">The project is saved in the browser automatically. Export saves it to a file.</p>

    <div v-if="projectWarnings.length" class="callout callout--warn">
      <div v-for="w in projectWarnings" :key="w" class="warning-line">{{ w }}</div>
    </div>
  </section>
</template>

<script lang="ts" src="./BaseList.ts"></script>
