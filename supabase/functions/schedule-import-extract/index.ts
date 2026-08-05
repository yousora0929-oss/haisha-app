/**
 * schedule-import-extract
 * 配車スケジュール PDF を Claude で抽出し、
 * schedule_import_batches / rows / order_change_proposals を作成する。
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const FUNCTION_VERSION = 1;
const CLAUDE_MODEL = 'claude-sonnet-4-6';

type ExtractHeader = {
  project_name?: string | null;
  contractor_name?: string | null;
  trading_company_name?: string | null;
  cooperative_name?: string | null;
  coordinator_name?: string | null;
  site_name?: string | null;
  site_address?: string | null;
  site_contacts?: { name?: string; phone?: string | null }[];
};

type ExtractRow = {
  date?: string | null;
  weekday_raw?: string | null;
  time?: string | null;
  factory_name_raw?: string | null;
  factory_phone_raw?: string | null;
  quantity_m3?: number | null;
  vehicle_type?: string | null;
  mix_design?: string | null;
  has_test?: boolean | null;
  notes?: string | null;
  row_confidence?: 'high' | 'low' | null;
  row_confidence_reason?: string | null;
};

type ExtractResult = {
  header?: ExtractHeader;
  rows?: ExtractRow[];
  extraction_notes?: string[];
};

type OrderRow = {
  id: string;
  project_id?: string | null;
  factory_site_id?: string | null;
  has_test?: boolean | null;
  status?: string | null;
  order_data?: Record<string, unknown> | null;
};

type ProposedChange = {
  field: string;
  old: string | number | boolean | null;
  new: string | number | boolean | null;
};

function pickString(...values: unknown[]): string {
  for (const value of values) {
    const text = value != null ? String(value).trim() : '';
    if (text) return text;
  }
  return '';
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function supabaseEnv(): { url: string; serviceKey: string } {
  return {
    url: Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') || '',
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  };
}

function getServiceClient(): SupabaseClient {
  const { url, serviceKey } = supabaseEnv();
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isServiceRoleAuthorized(req: Request): boolean {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!expected) return false;
  const auth = req.headers.get('Authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const apikey = (req.headers.get('apikey') || '').trim();
  return bearer === expected || apikey === expected;
}

async function isAdminAuthorized(req: Request, client: SupabaseClient): Promise<boolean> {
  const phone = pickString(req.headers.get('x-admin-phone'));
  const pass = pickString(req.headers.get('x-admin-password'));
  if (!phone || !pass) return false;
  const { data, error } = await client
    .from('admin_settings')
    .select('id')
    .eq('id', 1)
    .eq('phone_number', phone)
    .eq('login_password', pass)
    .maybeSingle();
  if (error) {
    console.warn('[schedule-import-extract] admin auth check failed', error);
    return false;
  }
  return Boolean(data?.id);
}

function corsHeaders(origin = '*'): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-admin-phone, x-admin-password',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function jsonResponse(body: unknown, status = 200, origin = '*'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function normalizeTimeLabel(raw: unknown): string {
  const text = pickString(raw).replace('：', ':');
  if (!text) return '';
  const m = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return text;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return text;
  return `${h}:${String(min).padStart(2, '0')}`;
}

function timeToMinutes(raw: unknown): number | null {
  const label = normalizeTimeLabel(raw);
  const m = label.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

function orderDeliveryTimeLabel(order: OrderRow): string {
  const od = asObject(order.order_data);
  const fromLabel = normalizeTimeLabel(
    od.timePointLabel ?? od.timeSlotLabel ?? od.time_point_label ?? od.time_slot_label,
  );
  if (fromLabel) return fromLabel;
  const minutesRaw = od.timeSlotMinutes ?? od.scheduleMatchMinutes ?? od.timeSlot;
  const minutes =
    typeof minutesRaw === 'number'
      ? minutesRaw
      : String(minutesRaw || '').match(/^\d+$/)
        ? Number(minutesRaw)
        : null;
  if (minutes == null || !Number.isFinite(minutes)) return '';
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function orderQuantity(order: OrderRow): number | null {
  const od = asObject(order.order_data);
  const raw = od.confirmedQuantityM3 ?? od.quantityM3 ?? od.quantityCube;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function orderVehicleType(order: OrderRow): string {
  const od = asObject(order.order_data);
  const raw = pickString(od.vehicleType, od.vehicle_type, od.vehicleLabel).toLowerCase();
  if (raw.includes('small') || raw.includes('小型')) return 'small';
  if (raw.includes('large') || raw.includes('大型')) return 'large';
  return raw;
}

function orderMix(order: OrderRow): string {
  const od = asObject(order.order_data);
  return pickString(od.confirmedMixText, od.mixText, od.mix_design);
}

function orderHasTest(order: OrderRow): boolean | null {
  if (typeof order.has_test === 'boolean') return order.has_test;
  const od = asObject(order.order_data);
  if (typeof od.has_test === 'boolean') return od.has_test;
  if (typeof od.hasTest === 'boolean') return od.hasTest as boolean;
  return null;
}

function orderPreferredDate(order: OrderRow): string {
  const od = asObject(order.order_data);
  return pickString(od.preferredDate, od.scheduleMatchDate, od.delivery_date);
}

function normalizeVehicleType(raw: unknown): string {
  const text = pickString(raw).toLowerCase();
  if (!text) return '';
  if (text.includes('引取')) return '引取';
  if (text.includes('small') || text.includes('小型')) return 'small';
  if (text.includes('large') || text.includes('大型')) return 'large';
  return pickString(raw);
}

function sameNumber(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.0001;
}

function sameBool(a: boolean | null, b: boolean | null): boolean {
  if (a == null && b == null) return true;
  return a === b;
}

function buildProposedChanges(order: OrderRow, row: {
  delivery_time: string | null;
  quantity_m3: number | null;
  vehicle_type: string | null;
  mix_design: string | null;
  has_test: boolean | null;
  notes: string | null;
}): ProposedChange[] {
  const changes: ProposedChange[] = [];
  const oldQty = orderQuantity(order);
  if (!sameNumber(oldQty, row.quantity_m3)) {
    changes.push({ field: 'quantity_m3', old: oldQty, new: row.quantity_m3 });
  }
  const oldTime = orderDeliveryTimeLabel(order);
  const newTime = normalizeTimeLabel(row.delivery_time);
  if (pickString(oldTime) !== pickString(newTime)) {
    changes.push({ field: 'delivery_time', old: oldTime || null, new: newTime || null });
  }
  const oldVehicle = orderVehicleType(order);
  const newVehicle = normalizeVehicleType(row.vehicle_type);
  if (oldVehicle && newVehicle && oldVehicle !== newVehicle && newVehicle !== '引取') {
    changes.push({ field: 'vehicle_type', old: oldVehicle, new: newVehicle });
  }
  const oldMix = orderMix(order);
  const newMix = pickString(row.mix_design);
  if (pickString(oldMix) !== pickString(newMix)) {
    changes.push({ field: 'mix_design', old: oldMix || null, new: newMix || null });
  }
  const oldTest = orderHasTest(order);
  if (!sameBool(oldTest, row.has_test)) {
    changes.push({ field: 'has_test', old: oldTest, new: row.has_test });
  }
  return changes;
}

function buildExtractionPrompt(factoryList: string): string {
  return `あなたは生コンクリートの配車スケジュール表（PDF）から情報を抽出するアシスタントです。
添付されたPDFを読み取り、以下のルールに従って厳密にJSON形式のみで出力してください。
説明文・前置き・Markdownのコードフェンスは一切付けないでください。

【既知の工場一覧（参考。表記ゆれの判断材料として使い、無理に正式名へ書き換えないこと）】
${factoryList}

【抽出ルール】
1. ヘッダー情報（物件名・業者名・商社名・組合名・現場名・現場住所・現場担当者）は、
   書類全体で共通の情報として1回だけ抽出する。各明細行には繰り返さない。
2. 現場担当者情報は「氏名＋電話番号」がフリーテキストでまとめて書かれていることが多い
   （例："船越氏：050-3198-1678　あべ木氏：050-3137-1976"）。これを氏名と電話番号のペアに
   分解し、site_contacts配列にすべて列挙すること。電話番号が読み取れない場合はnullでよい。
3. 明細行として抽出するのは、日付があり、かつ工場名・数量など実際の配車情報が入っている行のみ。
   以下は明細データではないため抽出対象から除外すること：
   - 日付欄はあるが他の項目が空欄の行（土日の休工日など）
   - 「累計トータル」等の集計・合計行
   - ページ区切りのたびに繰り返される表ヘッダー行（"日付 曜日 時間 担当工場名..." 等）
   - 「■ 基本情報」等のセクション見出し行
4. 車両区分が「引取」の行は電話注文（配車システム対象外）のため抽出しないこと。
5. 数量は数値のみを quantity_m3 に入れる（単位「m³」の文字は含めない）。数値として読み取れない
   場合はnullとし、該当行の row_confidence を "low" にすること。
6. 試験欄は「有」→ true、「無」→ false、判読不能→ null に変換すること。
7. 日付は "YYYY-MM-DD" 形式に正規化すること。表に書かれている曜日は weekday_raw にそのまま
   保持し、日付から推測した曜日で上書きしないこと。
8. 工場名・商社名・業者名などの固有名詞は、原文の表記をそのまま保持すること
   （略称・表記ゆれを推測で正式名称に統一しない）。
9. 組合名（cooperative_name）の末尾に個人名が続いている場合は分離すること。
   例: 「○○生コン協同組合　山田太郎」→ cooperative_name="○○生コン協同組合"、
   coordinator_name="山田太郎"。個人名が無い場合は coordinator_name は null。
10. 読み取りに自信が持てない項目がある行は row_confidence を "low" にし、
   row_confidence_reason に理由を一言添えること。
11. 除外した行や判断に迷った点があれば extraction_notes に日本語で簡潔に記録すること。

出力は下記スキーマに厳密に従ったJSONオブジェクト1つのみとしてください。

{
  "header": {
    "project_name": string | null,
    "contractor_name": string | null,
    "trading_company_name": string | null,
    "cooperative_name": string | null,
    "coordinator_name": string | null,
    "site_name": string | null,
    "site_address": string | null,
    "site_contacts": [{ "name": string, "phone": string | null }]
  },
  "rows": [
    {
      "date": "YYYY-MM-DD",
      "weekday_raw": string | null,
      "time": "HH:MM" | null,
      "factory_name_raw": string,
      "factory_phone_raw": string | null,
      "quantity_m3": number | null,
      "vehicle_type": string | null,
      "mix_design": string | null,
      "has_test": boolean | null,
      "notes": string | null,
      "row_confidence": "high" | "low",
      "row_confidence_reason": string | null
    }
  ],
  "extraction_notes": [string]
}`;
}

function parseClaudeJson(text: string): ExtractResult {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(raw) as ExtractResult;
}

async function callClaudeExtract(pdfBase64: string, factoryList: string): Promise<ExtractResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system: buildExtractionPrompt(factoryList),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: 'このPDFから配車スケジュールを抽出し、指定スキーマのJSONのみを返してください。',
            },
          ],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[schedule-import-extract] Claude API error', response.status, payload);
    throw new Error(`Claude API failed: ${response.status}`);
  }

  const textParts = Array.isArray(payload?.content)
    ? payload.content
        .filter((c: { type?: string; text?: string }) => c?.type === 'text')
        .map((c: { text?: string }) => c.text || '')
        .join('\n')
    : '';
  return parseClaudeJson(textParts);
}

async function resolveAliasId(
  client: SupabaseClient,
  entityType: 'factory' | 'organization' | 'customer',
  aliasText: string,
): Promise<string | null> {
  const alias = pickString(aliasText);
  if (!alias) return null;
  const { data } = await client
    .from('entity_aliases')
    .select('entity_id')
    .eq('entity_type', entityType)
    .eq('alias_text', alias)
    .maybeSingle();
  return pickString(data?.entity_id) || null;
}

async function resolveProjectId(client: SupabaseClient, projectName: string): Promise<string | null> {
  const name = pickString(projectName);
  if (!name) return null;
  const { data } = await client.from('projects').select('id, name').ilike('name', name).limit(5);
  const exact = (data || []).find((p) => pickString(p.name).toLowerCase() === name.toLowerCase());
  return pickString(exact?.id) || null;
}

async function sendFactoryPush(factoryId: string, title: string, message: string, orderId?: string) {
  const appId = Deno.env.get('ONESIGNAL_APP_ID') || '';
  const apiKey = Deno.env.get('ONESIGNAL_REST_API_KEY') || '';
  if (!appId || !apiKey || !factoryId || !message) return;

  const externalId = factoryId.startsWith('factory_') ? factoryId : `factory_${factoryId}`;
  try {
    const res = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        include_aliases: { external_id: [externalId] },
        target_channel: 'push',
        headings: { ja: title, en: title },
        contents: { ja: message, en: message },
        data: {
          type: 'schedule_change_proposal',
          orderId: orderId || '',
          app: 'factory',
        },
      }),
    });
    if (!res.ok) {
      console.warn('[schedule-import-extract] OneSignal failed', res.status, await res.text());
    }
  } catch (e) {
    console.warn('[schedule-import-extract] OneSignal error', e);
  }
}

function summarizeChanges(changes: ProposedChange[]): string {
  return changes
    .map((c) => {
      if (c.field === 'quantity_m3') return `数量 ${c.old ?? '?'}m³→${c.new ?? '?'}m³`;
      if (c.field === 'delivery_time') return `時間 ${c.old ?? '?'}→${c.new ?? '?'}`;
      if (c.field === 'vehicle_type') return `車両 ${c.old ?? '?'}→${c.new ?? '?'}`;
      if (c.field === 'mix_design') return `配合 ${c.old ?? '?'}→${c.new ?? '?'}`;
      if (c.field === 'has_test') {
        const oldLabel = c.old === true ? '有' : c.old === false ? '無' : '?';
        const newLabel = c.new === true ? '有' : c.new === false ? '無' : '?';
        return `試験 ${oldLabel}→${newLabel}`;
      }
      return `${c.field}: ${c.old ?? '?'}→${c.new ?? '?'}`;
    })
    .join(' / ');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin') || '*';
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed', v: FUNCTION_VERSION }, 405, origin);
  }

  const client = getServiceClient();
  const authorized =
    isServiceRoleAuthorized(req) || (await isAdminAuthorized(req, client));
  if (!authorized) {
    return jsonResponse({ ok: false, error: 'Unauthorized', v: FUNCTION_VERSION }, 401, origin);
  }

  try {
    const body = await req.json();
    const pdfBase64 = pickString(body?.pdf_base64, body?.pdfBase64).replace(/^data:application\/pdf;base64,/, '');
    const sourceFileName = pickString(body?.source_file_name, body?.fileName) || null;
    const sourceStoragePath = pickString(body?.source_storage_path, body?.storagePath) || null;
    const uploadedBy = pickString(
      body?.uploaded_by,
      body?.uploadedBy,
      req.headers.get('x-admin-phone'),
    ) || null;

    if (!pdfBase64) {
      return jsonResponse({ ok: false, error: 'pdf_base64 is required', v: FUNCTION_VERSION }, 400, origin);
    }

    const { data: factories, error: factoriesErr } = await client
      .from('factories')
      .select('id, name')
      .order('name');
    if (factoriesErr) throw factoriesErr;
    const factoryList = (factories || [])
      .map((f) => `- ${pickString(f.name)}（ID: ${pickString(f.id)}）`)
      .join('\n') || '(工場マスタなし)';

    const extracted = await callClaudeExtract(pdfBase64, factoryList);
    const header = extracted.header || {};
    const siteContacts = Array.isArray(header.site_contacts) ? header.site_contacts : [];
    const extractionNotes = Array.isArray(extracted.extraction_notes)
      ? extracted.extraction_notes.map((n) => String(n))
      : [];

    const projectId = await resolveProjectId(client, pickString(header.project_name));
    const contractorCustomerId = await resolveAliasId(
      client,
      'customer',
      pickString(header.contractor_name),
    );
    const agentOrganizationId = await resolveAliasId(
      client,
      'organization',
      pickString(header.trading_company_name),
    );

    const { data: batch, error: batchErr } = await client
      .from('schedule_import_batches')
      .insert({
        source_file_name: sourceFileName,
        source_storage_path: sourceStoragePath,
        uploaded_by: uploadedBy,
        status: 'pending_review',
        header_raw: header,
        site_contacts_raw: siteContacts,
        extraction_notes: extractionNotes,
        project_id: projectId,
        contractor_customer_id: contractorCustomerId,
        agent_organization_id: agentOrganizationId,
      })
      .select('*')
      .single();
    if (batchErr) throw batchErr;

    type PreparedRow = {
      batch_id: string;
      row_date: string;
      weekday_raw: string | null;
      delivery_time: string | null;
      factory_name_raw: string;
      factory_id: string | null;
      factory_phone_raw: string | null;
      quantity_m3: number | null;
      vehicle_type: string | null;
      mix_design: string | null;
      has_test: boolean | null;
      notes: string | null;
      row_confidence: 'high' | 'low';
      row_confidence_reason: string | null;
      row_status: string;
      match_type: string | null;
      matched_order_id: string | null;
      _tempKey: string;
    };

    const prepared: PreparedRow[] = [];
    const changesByTempKey = new Map<string, ProposedChange[]>();
    for (const raw of extracted.rows || []) {
      const factoryName = pickString(raw.factory_name_raw);
      const rowDate = pickString(raw.date);
      if (!factoryName || !rowDate) continue;
      const vehicle = normalizeVehicleType(raw.vehicle_type);
      if (vehicle === '引取') continue;

      const factoryId = await resolveAliasId(client, 'factory', factoryName);
      const qty =
        raw.quantity_m3 != null && Number.isFinite(Number(raw.quantity_m3))
          ? Number(raw.quantity_m3)
          : null;

      prepared.push({
        batch_id: batch.id,
        row_date: rowDate,
        weekday_raw: pickString(raw.weekday_raw) || null,
        delivery_time: normalizeTimeLabel(raw.time) || null,
        factory_name_raw: factoryName,
        factory_id: factoryId,
        factory_phone_raw: pickString(raw.factory_phone_raw) || null,
        quantity_m3: qty,
        vehicle_type: vehicle || pickString(raw.vehicle_type) || null,
        mix_design: pickString(raw.mix_design) || null,
        has_test: typeof raw.has_test === 'boolean' ? raw.has_test : null,
        notes: pickString(raw.notes) || null,
        row_confidence: raw.row_confidence === 'low' ? 'low' : 'high',
        row_confidence_reason: pickString(raw.row_confidence_reason) || null,
        row_status: 'pending',
        match_type: null,
        matched_order_id: null,
        _tempKey: `${rowDate}|${factoryId || factoryName}|${normalizeTimeLabel(raw.time)}|${prepared.length}`,
      });
    }

    // Match only when project + factory resolved
    const matchable = prepared.filter((r) => projectId && r.factory_id);
    const unmatchedOrderIds = new Set<string>();
    const matchedOrderIds = new Set<string>();

    let candidateOrders: OrderRow[] = [];
    if (projectId && matchable.length) {
      const factoryIds = [...new Set(matchable.map((r) => r.factory_id!).filter(Boolean))];
      const dates = [...new Set(matchable.map((r) => r.row_date))];
      const { data: orders, error: ordersErr } = await client
        .from('orders')
        .select('id, project_id, factory_site_id, has_test, status, order_data')
        .eq('project_id', projectId)
        .in('factory_site_id', factoryIds)
        .not('status', 'in', '("deleted","customer_cancelled","cancelled")');
      if (ordersErr) throw ordersErr;
      candidateOrders = (orders || []).filter((o) => {
        const d = orderPreferredDate(o as OrderRow);
        return dates.includes(d);
      }) as OrderRow[];
      for (const o of candidateOrders) unmatchedOrderIds.add(o.id);
    }

    // Stage 1: exact time match
    for (const row of prepared) {
      if (!projectId || !row.factory_id) {
        row.row_status = 'pending';
        row.match_type = null;
        continue;
      }
      const hits = candidateOrders.filter((o) => {
        if (matchedOrderIds.has(o.id)) return false;
        if (pickString(o.factory_site_id) !== row.factory_id) return false;
        if (orderPreferredDate(o) !== row.row_date) return false;
        return normalizeTimeLabel(orderDeliveryTimeLabel(o)) === normalizeTimeLabel(row.delivery_time);
      });

      if (hits.length === 1) {
        const order = hits[0];
        matchedOrderIds.add(order.id);
        unmatchedOrderIds.delete(order.id);
        row.matched_order_id = order.id;
        const changes = buildProposedChanges(order, row);
        if (changes.length === 0) {
          row.match_type = 'exact_match_no_change';
          row.row_status = 'excluded';
        } else {
          row.match_type = 'exact_match_changed';
          row.row_status = 'change_proposed';
          changesByTempKey.set(row._tempKey, changes);
        }
      } else if (hits.length > 1) {
        row.match_type = 'ambiguous_multi_match';
        row.row_status = 'needs_admin_review';
      }
      // hits.length === 0 → Stage 2
    }

    // Stage 2: 同日・同工場の未マッチをグループ単位で判定
    const stage2Groups = new Map<string, PreparedRow[]>();
    for (const row of prepared) {
      if (row.match_type != null || !projectId || !row.factory_id) continue;
      const key = `${row.row_date}|${row.factory_id}`;
      if (!stage2Groups.has(key)) stage2Groups.set(key, []);
      stage2Groups.get(key)!.push(row);
    }

    for (const [, groupRows] of stage2Groups) {
      const factoryId = groupRows[0].factory_id!;
      const rowDate = groupRows[0].row_date;
      const unmatchedOrders = candidateOrders.filter(
        (o) =>
          unmatchedOrderIds.has(o.id) &&
          pickString(o.factory_site_id) === factoryId &&
          orderPreferredDate(o) === rowDate,
      );

      if (unmatchedOrders.length === 1 && groupRows.length === 1) {
        const order = unmatchedOrders[0];
        const row = groupRows[0];
        matchedOrderIds.add(order.id);
        unmatchedOrderIds.delete(order.id);
        row.matched_order_id = order.id;
        row.match_type = 'time_shifted_match';
        row.row_status = 'change_proposed';
        changesByTempKey.set(row._tempKey, buildProposedChanges(order, row));
      } else if (unmatchedOrders.length === 0) {
        for (const row of groupRows) {
          row.match_type = 'new';
          row.row_status = 'pending';
        }
      } else {
        for (const row of groupRows) {
          row.match_type = 'ambiguous_multi_match';
          row.row_status = 'needs_admin_review';
        }
      }
    }

    const insertRows = prepared.map((r) => ({
      batch_id: r.batch_id,
      row_date: r.row_date,
      weekday_raw: r.weekday_raw,
      delivery_time: r.delivery_time,
      factory_name_raw: r.factory_name_raw,
      factory_id: r.factory_id,
      factory_phone_raw: r.factory_phone_raw,
      quantity_m3: r.quantity_m3,
      vehicle_type: r.vehicle_type,
      mix_design: r.mix_design,
      has_test: r.has_test,
      notes: r.notes,
      row_confidence: r.row_confidence,
      row_confidence_reason: r.row_confidence_reason,
      row_status: r.row_status,
      match_type: r.match_type,
      matched_order_id: r.matched_order_id,
    }));

    const { data: insertedRows, error: rowsErr } = await client
      .from('schedule_import_rows')
      .insert(insertRows)
      .select('*');
    if (rowsErr) throw rowsErr;

    let changeProposedCount = 0;
    let excludedCount = 0;
    let newCount = 0;
    let needsAdminCount = 0;
    let unresolvedFactoryCount = 0;

    for (let i = 0; i < (insertedRows || []).length; i += 1) {
      const inserted = insertedRows![i];
      const preparedRow = prepared[i];
      if (!inserted.factory_id) unresolvedFactoryCount += 1;
      if (inserted.row_status === 'excluded') excludedCount += 1;
      if (inserted.match_type === 'new') newCount += 1;
      if (inserted.row_status === 'needs_admin_review') needsAdminCount += 1;

      if (inserted.row_status !== 'change_proposed' || !inserted.matched_order_id || !inserted.factory_id) {
        continue;
      }

      const changes = (preparedRow && changesByTempKey.get(preparedRow._tempKey)) || [];
      if (!changes.length) continue;

      const { error: propErr } = await client.from('order_change_proposals').insert({
        order_id: inserted.matched_order_id,
        schedule_import_row_id: inserted.id,
        factory_id: inserted.factory_id,
        proposed_changes: changes,
        status: 'pending_factory_response',
      });
      if (propErr) {
        console.error('[schedule-import-extract] proposal insert failed', propErr);
        continue;
      }
      changeProposedCount += 1;

      const factoryName = pickString(inserted.factory_name_raw) || inserted.factory_id;
      const dateLabel = String(inserted.row_date || '').replace(/-/g, '/');
      await sendFactoryPush(
        inserted.factory_id,
        '予定変更のお知らせ',
        `${dateLabel} ${factoryName}：${summarizeChanges(changes)} に変更されました`,
        inserted.matched_order_id,
      );
    }

    return jsonResponse(
      {
        ok: true,
        v: FUNCTION_VERSION,
        batch_id: batch.id,
        project_id: projectId,
        summary: {
          total_rows: (insertedRows || []).length,
          new_rows: newCount,
          change_proposed: changeProposedCount,
          no_change: excludedCount,
          needs_admin_review: needsAdminCount,
          unresolved_factory: unresolvedFactoryCount,
        },
      },
      200,
      origin,
    );
  } catch (error) {
    console.error('[schedule-import-extract] failed', error);
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        v: FUNCTION_VERSION,
      },
      500,
      origin,
    );
  }
});
