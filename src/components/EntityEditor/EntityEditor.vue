<!--
  EntityEditor – the editor panel of the selected node or link: factory, mine, Receiver, Dispatcher,
  storage, inter-base rail; rail lines and links have their own editor components
  (logic: EntityEditor.ts, styles: EntityEditor.scss).
-->
<template>
  <aside v-if="editing" class="editor" role="dialog" aria-label="Editor">
    <header class="editor-head">
      <h2>{{ TITLES[editing.kind] }}</h2>
      <button type="button" class="icon-btn" title="Close (Esc)" @click="close">×</button>
    </header>

    <!-- ===================== FACTORY ===================== -->
    <template v-if="factory">
      <template v-if="factoryRecipe">
        <label class="field">
          <span>Recipe (building)</span>
          <select :value="factory.factory.recipe" @change="setFactoryRecipe(val($event))">
            <option v-for="r in sameProduct" :key="r.id" :value="r.id">
              {{ r.name }} · {{ index.building(r.building).name
              }}{{ index.building(r.building).upgradeOf ? ' ↑' : '' }}{{ r.perCycle ? ' ⚠︎' : '' }}
            </option>
          </select>
        </label>

        <div class="field">
          <span>Machine count</span>
          <div class="segmented" role="radiogroup" aria-label="Machine count">
            <button
              type="button"
              role="radio"
              :aria-checked="factory.factory.auto"
              :class="{ active: factory.factory.auto }"
              @click="setFactoryAuto(true)"
            >
              Automatic
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="!factory.factory.auto"
              :class="{ active: !factory.factory.auto }"
              @click="setFactoryAuto(false)"
            >
              Manual
            </button>
          </div>
        </div>

        <div class="row2">
          <label class="field">
            <span>Machines (multiplier)</span>
            <input
              type="number"
              min="0"
              step="any"
              :value="shownCount"
              @change="setFactoryCount(numVal($event))"
            />
          </label>
          <label class="field">
            <span>{{ index.item(factoryRecipe.product).name }} {{ RATE_UNIT_LABEL }}</span>
            <input
              type="number"
              min="0"
              step="any"
              :value="shownOutput"
              :disabled="!perMachine"
              @change="setFactoryOutput(numVal($event))"
            />
          </label>
        </div>

        <p class="hint">
          <template v-if="factoryNode?.countMode === 'auto'">
            Automatic: as many machines as the material reaching the linked inputs feeds, rounded up (X full +
            1 partly working). More material: it grows; less: it shrinks. Typing a number switches to manual.
          </template>
          <template v-else-if="factoryNode?.countMode === 'auto-fallback'">
            Automatic, but there is no linked input (or no rate) to size it from: the typed machine count is
            used. Link an input and it is sized from there.
          </template>
          <template v-else>Manual: runs with the machine count you typed (fractions allowed).</template>
        </p>

        <!-- No cycle time data: explanation and manual entry -->
        <div v-if="factoryNote" class="missing-box">
          <div class="missing-text">⚠︎ {{ factoryNote.text }}</div>
          <div class="muted">Per cycle: {{ perCycleText(factoryRecipe, itemName) }}</div>
          <label class="cycle-field">
            Cycle time (s):
            <input
              type="number"
              min="0"
              step="any"
              :value="factoryCycleTime ?? ''"
              placeholder="not set"
              aria-label="Manual cycle time in seconds"
              @change="setFactoryCycleTime($event)"
            />
            <button v-if="factoryCycleTime" type="button" class="link-btn" @click="setFactoryCycleTime(null)">
              Delete
            </button>
          </label>
          <div class="muted">
            The manual value is saved with the project (and exported with it); once the data is updated, the
            data is used.
          </div>
        </div>

        <div v-if="factoryNode" class="editor-status">
          <div v-if="factoryReduced && factoryNode.countMode === 'auto'" class="reduced">
            <strong>Effective: {{ factoryPercent }}</strong> – material for
            {{ formatCount(factoryNode.effectiveCount ?? 0) }} machines arrives, so
            {{ formatCount(factoryNode.count) }}
            machines (rounded up; the last one works partly).
          </div>
          <div v-else-if="factoryReduced" class="reduced">
            <strong>Effective: {{ factoryPercent }}</strong> –
            {{ formatCount(factoryNode.effectiveCount ?? 0) }} machines' worth works (set:
            {{ formatCount(factoryNode.count) }}), because one linked input gets less. Its output is lower by
            as much, which is a shortage at the next factory.
          </div>

          <div v-for="p in factoryNode.inputs" :key="p.id" :class="{ bad: p.gap > 0.001 }">
            <ItemIcon standalone :item="index.item(p.item)" :size="14" /> {{ index.item(p.item).name }}:
            {{ formatRate(p.rate) }} needed, {{ formatRate(p.linked ? p.flow : (p.effective ?? p.rate)) }}
            {{ p.linked ? 'arrives' : 'assumed' }}{{ inputNote(p) }}
          </div>

          <div v-for="p in factoryNode.outputs" :key="p.id" :class="{ reduced: factoryReduced }">
            <ItemIcon standalone :item="index.item(p.item)" :size="14" /> {{ index.item(p.item).name }}:
            <template v-if="factoryReduced">
              {{ formatRate(p.effective ?? p.rate) }} made (nominal {{ formatRate(p.rate) }})
            </template>
            <template v-else>{{ formatRate(p.rate) }} made</template>{{ outputNote(p) }}
          </div>

          <div>
            Power: <strong>{{ formatPower(factoryNode.power) }}</strong>
            <span class="muted">
              ({{ formatQuantity(factoryNode.placed, 'machine') }} ×
              {{ formatPower(factoryNode.building?.power ?? 0) }}; a fractional machine counts as a whole one)
            </span>
          </div>
          <div v-if="factoryNode.warning" class="bad">{{ factoryNode.warning }}</div>
        </div>

        <div class="btn-row">
          <button type="button" class="link-btn" :disabled="!factoryShort" @click="chainFactory">
            Build chain
          </button>
          <button type="button" class="link-btn" @click="balanceFactory">Balance</button>
        </div>

        <UpgradeButtons
          :options="factoryUpgrades"
          :building="index.building(factoryRecipe.building).name"
          noun="factory"
          @upgrade="upgradeFactory"
        />

        <p class="hint">
          A factory runs at most at its machine count. Balance sets it to the demand of the linked consumers
          (it becomes a manual count; when its output is not linked, this is the end of the chain: your goal).
          Another building (e.g. v.2): the Upgrade button, the recipe picker, or right-click › Upgrade.
        </p>
      </template>

      <p v-else class="hint bad">This recipe is no longer in the data ({{ factory.factory.recipe }}).</p>

      <div class="btn-row">
        <button
          type="button"
          class="danger-btn"
          @click="remove(factory.base.id, nodeIds.factory(factory.factory.id))"
        >
          Delete
        </button>
      </div>
    </template>

    <!-- ===================== MINE ===================== -->
    <template v-else-if="mine && mineBuilding">
      <label class="field">
        <span>What it mines</span>
        <select :value="mine.mine.item ?? ''" @change="setMineItem(val($event) || null)">
          <option value="">— choose —</option>
          <optgroup v-if="mineItems.preferred.length" label="Requested in this base">
            <option v-for="i in mineItems.preferred" :key="i.id" :value="i.id">{{ i.name }}</option>
          </optgroup>
          <optgroup label="Other minable items">
            <option v-for="i in mineItems.rest" :key="i.id" :value="i.id">{{ i.name }}</option>
          </optgroup>
        </select>
      </label>

      <label class="field">
        <span>Mine building</span>
        <select :value="mine.mine.building" @change="setMineBuilding(val($event))">
          <option v-for="b in mineBuildings" :key="b.id" :value="b.id">
            {{ b.name }}{{ b.upgradeOf ? ' ↑' : ''
            }}{{ mineBuildingRate(b) ? ' · ' + mineBuildingRate(b) : '' }}
          </option>
        </select>
      </label>

      <!-- Purity: only when this item and building have several, and the output is not custom -->
      <div v-if="minePurities.length > 1 && !customOutput" class="field">
        <span>Node purity</span>
        <div class="segmented segmented--tall" role="radiogroup" aria-label="Purity">
          <button
            v-for="p in minePurities"
            :key="p.id"
            type="button"
            role="radio"
            :aria-checked="mineInfo?.purityName === p.name"
            :class="{ active: mineInfo?.purityName === p.name }"
            @click="updateMine(mine.mine.id, { purity: p.id })"
          >
            {{ p.name }}
            <span class="seg-sub">{{ purityRate(p.id) }} {{ RATE_UNIT_LABEL }}</span>
          </button>
        </div>
      </div>
      <p v-else-if="minePurities.length === 1 && !customOutput" class="hint purity-note">
        Purity: {{ minePurities[0].name }} (the only one for this item)
      </p>

      <div class="row2">
        <label class="field">
          <span>Buildings</span>
          <input type="number" min="0" step="any" :value="mine.mine.count" @change="setMineCount" />
        </label>
        <label class="field">
          <span>Total output {{ RATE_UNIT_LABEL }}</span>
          <input
            type="number"
            min="0"
            step="any"
            :value="mineOutputValue"
            :disabled="!customOutput"
            @change="setMineOutput"
          />
        </label>
      </div>

      <label class="check">
        <input type="checkbox" :checked="customOutput" @change="toggleCustomOutput(checked($event))" />
        Custom output (e.g. this node stands for all such mines of mine)
      </label>

      <div v-if="mineInfo && mineNode" class="editor-status">
        <div v-if="!customOutput">
          Per building: <strong>{{ formatRate(mineInfo.perBuilding) }}</strong> {{ RATE_UNIT_LABEL }}
        </div>
        <div>
          Gives: <strong>{{ formatRate(mineInfo.total) }}</strong> {{ RATE_UNIT_LABEL }}, of which
          {{ formatRate(mineInfo.used) }} is taken
        </div>
        <div>
          Power: {{ formatPower(mineNode.power) }}
          <span class="muted">({{ formatQuantity(mineNode.placed, 'building') }})</span>
        </div>
        <div v-if="mineNode.warning" class="bad">{{ mineNode.warning }}</div>
      </div>

      <UpgradeButtons
        v-if="mine.mine.item && mineBuilding"
        :options="mineUpgrades"
        :building="mineBuilding.name"
        noun="mine"
        @upgrade="upgradeMine"
      />

      <div class="btn-row">
        <button type="button" class="link-btn" :disabled="customOutput" @click="balanceMine">Balance</button>
        <button type="button" class="danger-btn" @click="remove(mine.base.id, nodeIds.mine(mine.mine.id))">
          Delete
        </button>
      </div>

      <p class="hint">
        A mine gives building count × the rate of its purity, or what you enter as custom output. Power and
        cost count the buildings (a fraction counts as a whole one).
      </p>
    </template>

    <!-- ===================== RECEIVER ===================== -->
    <template v-else-if="receiver">
      <label class="field">
        <span>Name (pairing uses it)</span>
        <input
          type="text"
          :value="receiver.receiver.name"
          @input="updateReceiver(receiver.receiver.id, { name: val($event) })"
        />
      </label>

      <label class="field">
        <span>Building</span>
        <select
          :value="receiver.receiver.building"
          @change="updateReceiver(receiver.receiver.id, { building: val($event) })"
        >
          <option v-for="b in buildingsOfType('receiver')" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </label>

      <label class="field">
        <span>Which item it supplies</span>
        <select :value="receiver.receiver.item ?? ''" @change="setReceiverItem(val($event) || null)">
          <option value="">— choose —</option>
          <optgroup v-if="receiverItems.preferred.length" label="Requested in this base">
            <option v-for="i in receiverItems.preferred" :key="i.id" :value="i.id">{{ i.name }}</option>
          </optgroup>
          <optgroup label="Other items">
            <option v-for="i in receiverItems.rest" :key="i.id" :value="i.id">{{ i.name }}</option>
          </optgroup>
        </select>
      </label>

      <div class="field">
        <span>{{ manyToOne ? 'Sending Dispatchers (N:1)' : 'Sending Dispatcher (1:1)' }}</span>

        <div
          v-for="x in receiverDispatchers"
          :key="x.dispatcher.id"
          class="pair-row"
          :class="{ 'pair-row--off': x.overridden }"
        >
          <span class="pair-name">
            {{ x.dispatcher.name }}
            <span class="muted"
              >· {{ x.base.name }} · {{ formatRate(rateOf(x.dispatcher)) }}{{ RATE_UNIT_LABEL }}</span
            >
            <span v-if="x.overridden" class="bad-text"> · overridden, does not send</span>
          </span>
          <button
            v-if="x.base.id !== receiver.base.id"
            type="button"
            class="icon-btn"
            title="Go to the Dispatcher"
            @click="goTo(x.base.id, nodeIds.dispatcher(x.dispatcher.id))"
          >
            ↗
          </button>
          <button type="button" class="icon-btn" title="Unpair" @click="pair(x.dispatcher.id, null)">
            ×
          </button>
        </div>

        <div v-if="!receiverDispatchers.length" class="entity-empty">no Dispatcher</div>

        <select value="" aria-label="Add a Dispatcher" @change="addDispatcher">
          <option value="">{{ addDispatcherLabel }}</option>
          <option v-for="o in dispatcherOptions" :key="o.d.id" :value="o.d.id">
            {{ o.d.name }} · {{ o.base.name }}{{ o.d.item ? ' · ' + itemName(o.d.item) : ''
            }}{{ o.current ? ` (now: ${o.current})` : '' }}
          </option>
        </select>

        <p v-if="!manyToOne" class="hint hint--flush">
          In the game a Receiver has one Dispatcher: setting another one overrides the old one.
        </p>
      </div>

      <div class="field">
        <span>Virtual dispatcher (calculate without a Dispatcher)</span>
        <div class="segmented" role="radiogroup" aria-label="Virtual dispatcher">
          <button
            type="button"
            role="radio"
            :aria-checked="!receiver.receiver.virtual"
            :class="{ active: !receiver.receiver.virtual }"
            @click="setVirtual('receiver', null)"
          >
            Off
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="receiver.receiver.virtual?.mode === 'rail'"
            :class="{ active: receiver.receiver.virtual?.mode === 'rail' }"
            @click="setVirtual('receiver', 'rail')"
          >
            By rails
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="receiver.receiver.virtual?.mode === 'custom'"
            :class="{ active: receiver.receiver.virtual?.mode === 'custom' }"
            @click="setVirtual('receiver', 'custom')"
          >
            Custom
          </button>
        </div>
      </div>

      <label v-if="receiver.receiver.virtual?.mode === 'custom'" class="field">
        <span>Virtual dispatcher gives at most ({{ RATE_UNIT_LABEL }})</span>
        <input
          type="number"
          min="0"
          step="any"
          :value="receiver.receiver.virtual.rate"
          @change="setVirtualRate('receiver', numVal($event))"
        />
      </label>

      <p v-if="receiver.receiver.virtual" class="hint">
        <template v-if="receiverDispatchers.length">Not used: the Receiver has a Dispatcher.</template>
        <template v-else-if="!receiver.receiver.item">
          Not used yet: the Receiver has no item (link a consumer or choose one).
        </template>
        <template v-else>
          The Receiver gives its item as if a Dispatcher sent it: {{ recvVirtualLimitText }}; now
          {{ formatRate(recvVirtual?.flow ?? 0) }} {{ RATE_UNIT_LABEL }}.
        </template>
      </p>

      <div class="editor-status">
        <div>
          Gets: <strong>{{ formatRate(received) }}</strong> {{ RATE_UNIT_LABEL }}
          <span v-if="receiverDispatchers.length" class="muted"
            >(at most {{ formatRate(receiverCapacity) }})</span
          >
        </div>
        <div>Its linked consumers would request: {{ formatRate(receiverDemand) }} {{ RATE_UNIT_LABEL }}</div>
        <div v-if="receiverDemand - received > 0.001" class="bad">
          Too little: {{ formatRate(receiverDemand - received) }} {{ RATE_UNIT_LABEL }} –
          {{
            !receiverDispatchers.length
              ? 'no Dispatcher'
              : 'too little arrives on the sending side, or the throughput is too small'
          }}
        </div>
      </div>

      <div class="btn-row">
        <button
          type="button"
          class="danger-btn"
          @click="remove(receiver.base.id, nodeIds.receiver(receiver.receiver.id))"
        >
          Delete
        </button>
      </div>
    </template>

    <!-- ===================== DISPATCHER ===================== -->
    <template v-else-if="dispatcher">
      <label class="field">
        <span>Name (pairing uses it)</span>
        <input
          type="text"
          :value="dispatcher.dispatcher.name"
          @input="updateDispatcher(dispatcher.dispatcher.id, { name: val($event) })"
        />
      </label>

      <label class="field">
        <span>Building</span>
        <select
          :value="dispatcher.dispatcher.building"
          @change="updateDispatcher(dispatcher.dispatcher.id, { building: val($event) })"
        >
          <option v-for="b in buildingsOfType('dispatcher')" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </label>

      <label v-if="dispatcherInfo && dispatcherInfo.feedOptions.length > 1" class="field">
        <span>Feed rail (the throughput depends on it)</span>
        <select
          :value="dispatcher.dispatcher.feedRail ?? ''"
          @change="updateDispatcher(dispatcher.dispatcher.id, { feedRail: val($event) || null })"
        >
          <option value="">Automatic: {{ autoFeedLabel }}</option>
          <option v-for="t in dispatcherInfo.feedOptions" :key="t" :value="t">
            {{ t }} → {{ formatRate(feedRate(t)) }} {{ RATE_UNIT_LABEL }} throughput
          </option>
        </select>
      </label>

      <label class="field">
        <span>Item</span>
        <select
          :value="dispatcher.dispatcher.item ?? ''"
          :disabled="!!dispatcherReceiver?.receiver.item"
          @change="setDispatcherItem(val($event) || null)"
        >
          <option value="">— choose, or choose a Receiver —</option>
          <optgroup v-if="dispatcherItems.preferred.length" label="Produced in this base">
            <option v-for="i in dispatcherItems.preferred" :key="i.id" :value="i.id">{{ i.name }}</option>
          </optgroup>
          <optgroup label="Other items">
            <option v-for="i in dispatcherItems.rest" :key="i.id" :value="i.id">{{ i.name }}</option>
          </optgroup>
        </select>
      </label>

      <label class="field">
        <span>{{
          manyToOne ? 'Target Receiver (N:1)' : 'Target Receiver (1:1: overrides the existing pair)'
        }}</span>
        <select
          :value="dispatcher.dispatcher.receiverId ?? ''"
          @change="pair(dispatcher.dispatcher.id, val($event) || null)"
        >
          <option value="">— none —</option>
          <option v-for="o in receiverOptions" :key="o.r.id" :value="o.r.id">
            {{ o.r.name }} · {{ o.base.name }} · {{ o.r.item ? itemName(o.r.item) : 'no item'
            }}{{ receiverOptionNote(o.others) }}
          </option>
        </select>
      </label>

      <label class="check check--tight">
        <input v-model="showAllReceivers" type="checkbox" /> Every Receiver (regardless of the item)
      </label>

      <div class="field">
        <span>Virtual receiver (calculate without a Receiver)</span>
        <div class="segmented" role="radiogroup" aria-label="Virtual receiver">
          <button
            type="button"
            role="radio"
            :aria-checked="!dispatcher.dispatcher.virtual"
            :class="{ active: !dispatcher.dispatcher.virtual }"
            @click="setVirtual('dispatcher', null)"
          >
            Off
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="dispatcher.dispatcher.virtual?.mode === 'rail'"
            :class="{ active: dispatcher.dispatcher.virtual?.mode === 'rail' }"
            @click="setVirtual('dispatcher', 'rail')"
          >
            By rails
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="dispatcher.dispatcher.virtual?.mode === 'custom'"
            :class="{ active: dispatcher.dispatcher.virtual?.mode === 'custom' }"
            @click="setVirtual('dispatcher', 'custom')"
          >
            Custom
          </button>
        </div>
      </div>

      <label v-if="dispatcher.dispatcher.virtual?.mode === 'custom'" class="field">
        <span>Virtual receiver takes at most ({{ RATE_UNIT_LABEL }})</span>
        <input
          type="number"
          min="0"
          step="any"
          :value="dispatcher.dispatcher.virtual.rate"
          @change="setVirtualRate('dispatcher', numVal($event))"
        />
      </label>

      <p v-if="dispatcher.dispatcher.virtual" class="hint">
        <template v-if="dispatcher.dispatcher.receiverId"
          >Not used: the Dispatcher has a target Receiver.</template
        >
        <template v-else-if="!dispatcher.dispatcher.item">
          Not used yet: the Dispatcher has no item (link a producer or choose one).
        </template>
        <template v-else>
          The Dispatcher takes what its producers give, as if a Receiver took it: {{ dispVirtualLimitText }};
          now {{ formatRate(dispVirtual?.flow ?? 0) }} {{ RATE_UNIT_LABEL }}.
        </template>
      </p>

      <div class="editor-status">
        <div>
          Sends: <strong>{{ formatRate(sent) }}</strong> / {{ formatRate(dispatcherInfo?.rate ?? 0) }}
          {{ RATE_UNIT_LABEL }} throughput
          <span v-if="dispatcherInfo?.feedRail" class="muted">
            (from {{ dispatcherInfo.feedRail }} rail{{
              dispatcherInfo.fromLink ? ', from the manual rail of the incoming link' : ''
            }})
          </span>
        </div>
        <div v-if="manyToOne && siblingCount > 1">
          {{ siblingCount }} Dispatchers send to this Receiver in total.
        </div>
        <div v-if="dispNode?.warning" class="bad">{{ dispNode.warning }}</div>
      </div>

      <p class="hint">
        A Dispatcher sends what its linked producers give and the Receiver side takes (at most its
        throughput).
      </p>

      <div class="btn-row">
        <button
          v-if="dispatcherReceiver && dispatcherReceiver.base.id !== dispatcher.base.id"
          type="button"
          class="link-btn"
          @click="goTo(dispatcherReceiver.base.id, nodeIds.receiver(dispatcherReceiver.receiver.id))"
        >
          Go to the pair ({{ dispatcherReceiver.base.name }})
        </button>
        <button
          type="button"
          class="danger-btn"
          @click="remove(dispatcher.base.id, nodeIds.dispatcher(dispatcher.dispatcher.id))"
        >
          Delete
        </button>
      </div>
    </template>

    <!-- ===================== STORAGE ===================== -->
    <template v-else-if="storage">
      <label class="field">
        <span>Name</span>
        <input
          type="text"
          :value="storage.storage.name"
          @input="updateStorage(storage.storage.id, { name: val($event) })"
        />
      </label>

      <label class="field">
        <span>Building (capacity / unit)</span>
        <select
          :value="storage.storage.building"
          @change="updateStorage(storage.storage.id, { building: val($event) })"
        >
          <option v-for="b in buildingsOfType('storage')" :key="b.id" :value="b.id">
            {{ b.name }} · {{ formatRate(b.capacity ?? 0) }} pcs
          </option>
        </select>
      </label>

      <label class="field">
        <span>Item (one storage holds one kind of item)</span>
        <select :value="storage.storage.item ?? ''" @change="setStorageItem(val($event) || null)">
          <option value="">— choose —</option>
          <optgroup v-if="storageItems.preferred.length" label="Moving in this base">
            <option v-for="i in storageItems.preferred" :key="i.id" :value="i.id">{{ i.name }}</option>
          </optgroup>
          <optgroup label="Other items">
            <option v-for="i in storageItems.rest" :key="i.id" :value="i.id">{{ i.name }}</option>
          </optgroup>
        </select>
      </label>

      <label class="field">
        <span>Chained in a row (stack)</span>
        <input type="number" min="1" step="1" :value="storage.storage.count" @input="setStorageCount" />
      </label>

      <div v-if="storageInfo && storageText" class="editor-status">
        <div>
          Capacity: <strong>{{ formatRate(storageInfo.capacity) }}</strong> pcs ({{
            storageInfo.storage.count
          }}
          × {{ formatRate(storageInfo.unitCapacity) }})
        </div>
        <div>
          In: <strong>{{ formatRate(storageInfo.inflow) }}</strong> {{ RATE_UNIT_LABEL }}
          <template v-if="!storageInfo.sink">
            · out: <strong>{{ formatRate(storageInfo.outflow) }}</strong>
          </template>
        </div>
        <div :class="{ warn: storageText.tone === 'warn' }">{{ storageText.long }}</div>
      </div>

      <p class="hint">
        It passes on as much as it gets. When more arrives than is taken (or the outgoing rail is smaller),
        the excess accumulates in it (positive). Without an outgoing link it is a sink: it collects
        everything.
      </p>

      <div class="btn-row">
        <button
          type="button"
          class="danger-btn"
          @click="remove(storage.base.id, nodeIds.storage(storage.storage.id))"
        >
          Delete
        </button>
      </div>
    </template>

    <!-- ===================== INTER-BASE RAIL ===================== -->
    <template v-else-if="link">
      <label class="field">
        <span>Name</span>
        <input type="text" :value="link.name" @input="updateRailLink(link.id, { name: val($event) })" />
      </label>

      <label class="field">
        <span>From</span>
        <select :value="link.from" @change="updateRailLink(link.id, { from: val($event) })">
          <option v-for="b in otherBasesThan(link.to)" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </label>

      <label class="field">
        <span>To</span>
        <select :value="link.to" @change="updateRailLink(link.id, { to: val($event) })">
          <option v-for="b in otherBasesThan(link.from)" :key="b.id" :value="b.id">{{ b.name }}</option>
        </select>
      </label>

      <div class="field">
        <span>Items (one rail can carry several; dragging a link adds one too)</span>
        <div class="item-checklist">
          <template v-if="linkItems.preferred.length">
            <div class="group-label">Involved items</div>
            <label v-for="i in linkItems.preferred" :key="i.id" class="check">
              <input
                type="checkbox"
                :checked="link.items.includes(i.id)"
                @change="toggleLinkItem(i.id, checked($event))"
              />
              <ItemIcon standalone :item="i" :size="15" /> {{ i.name }}
            </label>
          </template>
          <div class="group-label">Other items</div>
          <label v-for="i in linkItems.rest" :key="i.id" class="check">
            <input
              type="checkbox"
              :checked="link.items.includes(i.id)"
              @change="toggleLinkItem(i.id, checked($event))"
            />
            <ItemIcon standalone :item="i" :size="15" /> {{ i.name }}
          </label>
        </div>
      </div>

      <div v-if="linkNode?.special?.type === 'railOut'" class="editor-status">
        <div>
          Flow: <strong>{{ formatRate(linkNode.special.total) }}</strong> {{ RATE_UNIT_LABEL }}
        </div>
        <div v-if="linkNode.rail" :class="{ warn: linkNode.rail.count > 1 }">
          Required rail: {{ railLabel(linkNode.rail) }}
          <template v-if="linkNode.rail.count > 1">
            (one {{ linkNode.rail.tier.name }} cannot carry it: parallel rails)
          </template>
        </div>
      </div>

      <p class="hint">
        Outgoing node in {{ baseName(link.from) }}, incoming node in {{ baseName(link.to) }}. Link the
        producers to the outgoing one, and the consumers from the incoming one.
      </p>

      <div class="btn-row">
        <button type="button" class="link-btn" @click="goTo(link.to, nodeIds.railIn(link.id))">
          Go to the incoming side
        </button>
        <button type="button" class="danger-btn" @click="remove(link.from, nodeIds.railOut(link.id))">
          Delete
        </button>
      </div>
    </template>

    <!-- ===================== RAIL LINE ===================== -->
    <RailLineEditor v-else-if="editing.kind === 'railLine'" :base-id="editing.baseId" :line-id="editing.id" />

    <!-- ===================== LINK ===================== -->
    <LinkEditor
      v-else-if="editing.kind === 'link'"
      :key="editing.id"
      :base-id="editing.baseId"
      :link-id="editing.id"
    />

    <p v-else class="hint">This element no longer exists.</p>
  </aside>
</template>

<script lang="ts" src="./EntityEditor.ts"></script>
<style lang="scss" scoped src="./EntityEditor.scss"></style>
