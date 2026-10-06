import { describe, expect, it } from 'vitest';
import {
  attachAvailabilityGroupsToSiteEntries,
  compareOrdersForFactoryInbox,
  formatOrderDateTimeSummary,
  groupInProgressOrders,
  groupOrdersBySiteForAssignedProjects,
  reservationGroupIdsFromOrders,
  resolveInProgressGroupStorageId,
  resolveNearestUpcomingOrder,
  sortFactoryInboxEntries,
} from './orderGrouping.js';

describe('orderGrouping in-progress collapse helpers', () => {
  it('prefers project id for group storage key', () => {
    expect(
      resolveInProgressGroupStorageId({
        type: 'group',
        key: 'site:A現場',
        site: 'A現場',
        orders: [
          { id: '1', project_id: 'proj-1', preferredDate: '2026-07-28' },
          { id: '2', projectId: 'proj-1', preferredDate: '2026-07-29' },
        ],
      }),
    ).toBe('project:proj-1');
  });

  it('falls back to site key when project ids differ', () => {
    expect(
      resolveInProgressGroupStorageId({
        type: 'group',
        key: 'site:A現場',
        site: 'A現場',
        orders: [
          { id: '1', project_id: 'proj-1' },
          { id: '2', project_id: 'proj-2' },
        ],
      }),
    ).toBe('site:A現場');
  });

  it('picks nearest upcoming order, else latest past', () => {
    const now = Date.parse('2026-07-28T09:00:00');
    const upcoming = resolveNearestUpcomingOrder(
      [
        { preferredDate: '2026-07-27', timeSlotMinutes: 600, timePointLabel: '10:00' },
        { preferredDate: '2026-07-28', timeSlotMinutes: 630, timePointLabel: '10:30' },
        { preferredDate: '2026-07-29', timeSlotMinutes: 480, timePointLabel: '8:00' },
      ],
      now,
    );
    expect(formatOrderDateTimeSummary(upcoming)).toBe('2026/7/28 · 10:30');

    const pastOnly = resolveNearestUpcomingOrder(
      [
        { preferredDate: '2026-07-26', timeSlotMinutes: 600, timePointLabel: '10:00' },
        { preferredDate: '2026-07-27', timeSlotMinutes: 480, timePointLabel: '8:00' },
      ],
      now,
    );
    expect(formatOrderDateTimeSummary(pastOnly)).toBe('2026/7/27 · 8:00');
  });
});

describe('groupOrdersBySiteForAssignedProjects reservation groups', () => {
  it('collects unique reservation_group_id in appearance order', () => {
    expect(
      reservationGroupIdsFromOrders([
        { id: '1', reservation_group_id: 'g-a' },
        { id: '2', reservation_group: { id: 'g-a' } },
        { id: '3', reservation_group_id: 'g-b' },
        { id: '4' },
      ]),
    ).toEqual(['g-a', 'g-b']);
  });

  it('puts reservation group orders into the same site group as other assigned orders', () => {
    const projectById = { 'proj-1': { main_factory_id: 'fac-1' } };
    const entries = groupOrdersBySiteForAssignedProjects(
      [
        {
          id: 'regular',
          project_id: 'proj-1',
          siteName: '北現場',
          preferredDate: '2026-09-12',
          timeSlotMinutes: 600,
        },
        {
          id: 'rg-1',
          project_id: 'proj-1',
          reservation_group_id: 'grp-9',
          siteName: '北現場',
          preferredDate: '2026-09-13',
          timeSlotMinutes: 540,
        },
        {
          id: 'rg-2',
          project_id: 'proj-1',
          reservation_group_id: 'grp-9',
          siteName: '北現場',
          preferredDate: '2026-09-14',
          timeSlotMinutes: 540,
        },
      ],
      projectById,
      { includeReservationGroups: true },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('group');
    expect(entries[0].site).toBe('北現場');
    expect(entries[0].orders.map((o) => o.id)).toEqual(['rg-1', 'rg-2', 'regular']);
    expect(reservationGroupIdsFromOrders(entries[0].orders)).toEqual(['grp-9']);
  });

  it('groups reservation orders by site even without assigned factory', () => {
    const entries = groupOrdersBySiteForAssignedProjects(
      [
        {
          id: 'rg-1',
          reservation_group_id: 'grp-1',
          siteName: '南現場',
          preferredDate: '2026-09-12',
          timeSlotMinutes: 480,
        },
        {
          id: 'rg-2',
          reservation_group_id: 'grp-1',
          siteName: '南現場',
          preferredDate: '2026-09-13',
          timeSlotMinutes: 480,
        },
      ],
      {},
      { includeReservationGroups: true },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('site:南現場');
    expect(entries[0].orders).toHaveLength(2);
  });
});

describe('factory inbox site grouping + sort', () => {
  it('nests availability cards into the matching site group', () => {
    const projectById = { 'proj-1': { main_factory_id: 'fac-1' } };
    const grouped = groupOrdersBySiteForAssignedProjects(
      [
        {
          id: 'regular',
          project_id: 'proj-1',
          siteName: '北現場',
          preferredDate: '2026-09-20',
          timeSlotMinutes: 600,
        },
      ],
      projectById,
      { includeReservationGroups: true },
    );
    const { entries, leftoverAvailabilityGroups } = attachAvailabilityGroupsToSiteEntries(grouped, [
      {
        groupId: 'g-1',
        orders: [
          {
            id: 'rg-1',
            reservation_group_id: 'g-1',
            siteName: '北現場',
            preferredDate: '2026-09-12',
            timeSlotMinutes: 480,
          },
        ],
      },
    ]);
    expect(leftoverAvailabilityGroups).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0].site).toBe('北現場');
    expect(entries[0].availabilityGroups.map((g) => g.groupId)).toEqual(['g-1']);
    expect(entries[0].orders.map((o) => o.id)).toEqual(['regular']);
  });

  it('creates a site group for availability-only reservations', () => {
    const { entries, leftoverAvailabilityGroups } = attachAvailabilityGroupsToSiteEntries(
      [{ type: 'single', key: 'order:spot', order: { id: 'spot', siteName: '別現場' } }],
      [
        {
          groupId: 'g-2',
          orders: [{ id: 'rg-2', reservation_group_id: 'g-2', siteName: '南現場' }],
        },
      ],
    );
    expect(leftoverAvailabilityGroups).toEqual([]);
    const siteGroup = entries.find((e) => e.type === 'group' && e.site === '南現場');
    expect(siteGroup?.availabilityGroups?.[0]?.groupId).toBe('g-2');
    expect(siteGroup?.orders).toEqual([]);
  });

  it('sorts by delivery datetime then site name', () => {
    const a = { id: 'a', siteName: 'い現場', preferredDate: '2026-10-01', timeSlotMinutes: 600 };
    const b = { id: 'b', siteName: 'あ現場', preferredDate: '2026-09-01', timeSlotMinutes: 480 };
    expect(compareOrdersForFactoryInbox(a, b, 'deliveryDate', 'asc')).toBeGreaterThan(0);
    expect(compareOrdersForFactoryInbox(a, b, 'siteName', 'asc')).toBeGreaterThan(0);
    const sorted = sortFactoryInboxEntries(
      [
        { type: 'single', key: 'a', order: a },
        { type: 'single', key: 'b', order: b },
      ],
      'siteName',
      'asc',
    );
    expect(sorted.map((e) => e.order.id)).toEqual(['b', 'a']);
  });
});

describe('groupInProgressOrders', () => {
  const projectById = {
    'proj-tunnel': { id: 'proj-tunnel', name: '令和6年度東九州道　九六位トンネル工事' },
  };

  it('groups the same project_id even when siteName text differs', () => {
    const groups = groupInProgressOrders(
      [
        { id: '1', project_id: 'proj-tunnel', siteName: '九六位トンネル', contractorName: '三井住友建設㈱', preferredDate: '2026-07-02', timeSlotMinutes: 480 },
        { id: '2', project_id: 'proj-tunnel', siteName: '令和6年度東九州道　九六位トンネル工事', contractorName: '三井住友建設㈱', preferredDate: '2026-07-01', timeSlotMinutes: 540 },
      ],
      { projectById },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('令和6年度東九州道　九六位トンネル工事');
    expect(groups[0].orders.map((order) => order.id)).toEqual(['2', '1']);
  });

  it('merges company-name variants of the same contractor', () => {
    const groups = groupInProgressOrders(
      [
        { id: '1', siteName: '河川改良工事', contractorName: '高聖建設工業㈱', contractor_customer_id: 'prime', preferredDate: '2026-07-01' },
        { id: '2', siteName: '河川改良工事', contractorName: '高聖建設工業株式会社', contractor_customer_id: 'sub', preferredDate: '2026-07-02' },
      ],
      {
        projectById: {},
        customersById: {
          prime: { organization_id: 'org-miura', company_name: '三浦国土建設㈱' },
          sub: { organization_id: 'org-kosei', company_name: '高聖建設工業㈱' },
        },
      },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].orders).toHaveLength(2);
  });

  it('keeps different contractors at the same site in separate groups', () => {
    const groups = groupInProgressOrders(
      [
        { id: '1', siteName: 'こまわり商會（有）様アパート新築工事', contractorName: '東建コーポレーション株式会社' },
        { id: '2', siteName: 'こまわり商會（有）様アパート新築工事', contractorName: '株式会社廣亜' },
      ],
      { projectById: {} },
    );
    expect(groups).toHaveLength(2);
  });

  it('does not collapse proxy orders onto the cooperative customer_id', () => {
    const groups = groupInProgressOrders(
      [
        { id: '1', customer_id: 'coop', siteName: 'スポット現場', contractorName: '株式会社S' },
        { id: '2', customer_id: 'coop', siteName: 'スポット現場', contractorName: '別の建設' },
      ],
      { projectById: {} },
    );
    expect(groups).toHaveLength(2);
  });

  it('merges spot sites that differ only by spaces', () => {
    const groups = groupInProgressOrders(
      [
        { id: '1', siteName: '大分市 下郡', contractorName: '㈱菅組' },
        { id: '2', siteName: '大分市　下郡', contractorName: '㈱菅組' },
      ],
      { projectById: {} },
    );
    expect(groups).toHaveLength(1);
  });

  const today = '2026-10-06';

  it('puts groups that include a delivery on or after today ahead of past-only groups', () => {
    const groups = groupInProgressOrders(
      [
        { id: 'past', siteName: '過去現場', contractorName: 'A社', preferredDate: '2026-07-13', timeSlotMinutes: 480 },
        { id: 'future', siteName: '今後現場', contractorName: 'B社', preferredDate: '2026-10-08', timeSlotMinutes: 540 },
      ],
      { projectById: {}, today },
    );
    expect(groups.map((group) => group.orders[0].id)).toEqual(['future', 'past']);
  });

  it('sorts upcoming groups by the nearest delivery from today, not the oldest order', () => {
    const groups = groupInProgressOrders(
      [
        { id: 'a-old', siteName: '現場A', contractorName: 'A社', preferredDate: '2026-07-13', timeSlotMinutes: 480 },
        { id: 'a-later', siteName: '現場A', contractorName: 'A社', preferredDate: '2026-10-20', timeSlotMinutes: 600 },
        { id: 'b-soon', siteName: '現場B', contractorName: 'B社', preferredDate: '2026-10-07', timeSlotMinutes: 480 },
      ],
      { projectById: {}, today },
    );
    expect(groups.map((group) => group.title)).toEqual(['現場B', '現場A']);
    expect(groups[1].orders.map((order) => order.id)).toEqual(['a-old', 'a-later']);
  });

  it('uses timeSlotMinutes for deliveries on the same day', () => {
    const groups = groupInProgressOrders(
      [
        { id: 'late', siteName: '午後', contractorName: 'A社', preferredDate: '2026-10-06', timeSlotMinutes: 900 },
        { id: 'early', siteName: '午前', contractorName: 'B社', preferredDate: '2026-10-06', timeSlotMinutes: 480 },
      ],
      { projectById: {}, today },
    );
    expect(groups.map((group) => group.title)).toEqual(['午前', '午後']);
  });

  it('sorts past-only groups by the latest delivery descending', () => {
    const groups = groupInProgressOrders(
      [
        { id: 'old', siteName: '古い', contractorName: 'A社', preferredDate: '2026-07-13', timeSlotMinutes: 480 },
        { id: 'mid', siteName: '新しい', contractorName: 'B社', preferredDate: '2026-08-01', timeSlotMinutes: 480 },
        { id: 'late', siteName: '新しい', contractorName: 'B社', preferredDate: '2026-09-01', timeSlotMinutes: 600 },
      ],
      { projectById: {}, today },
    );
    expect(groups.map((group) => group.title)).toEqual(['新しい', '古い']);
  });

  it('breaks equal upcoming times by the latest delivery, then title', () => {
    const sameLatest = groupInProgressOrders(
      [
        { id: 'i', siteName: 'い現場', contractorName: 'B社', preferredDate: '2026-10-07', timeSlotMinutes: 480 },
        { id: 'a', siteName: 'あ現場', contractorName: 'A社', preferredDate: '2026-10-07', timeSlotMinutes: 480 },
      ],
      { projectById: {}, today },
    );
    expect(sameLatest.map((group) => group.title)).toEqual(['あ現場', 'い現場']);

    const laterLast = groupInProgressOrders(
      [
        { id: 'a1', siteName: 'い現場', contractorName: 'A社', preferredDate: '2026-10-07', timeSlotMinutes: 480 },
        { id: 'a2', siteName: 'い現場', contractorName: 'A社', preferredDate: '2026-10-09', timeSlotMinutes: 480 },
        { id: 'b1', siteName: 'あ現場', contractorName: 'B社', preferredDate: '2026-10-07', timeSlotMinutes: 480 },
        { id: 'b2', siteName: 'あ現場', contractorName: 'B社', preferredDate: '2026-10-08', timeSlotMinutes: 480 },
      ],
      { projectById: {}, today },
    );
    expect(laterLast.map((group) => group.title)).toEqual(['い現場', 'あ現場']);
  });

  it('keeps groups that need attention ahead of other groups', () => {
    const groups = groupInProgressOrders(
      [
        { id: 'future', siteName: '今後', contractorName: 'A社', preferredDate: '2026-10-08', timeSlotMinutes: 480 },
        { id: 'past-unread', siteName: '過去未読', contractorName: 'B社', preferredDate: '2026-07-13', timeSlotMinutes: 480 },
      ],
      { projectById: {}, today, hasUnread: (order) => order.id === 'past-unread' },
    );
    expect(groups[0].orders[0].id).toBe('past-unread');
  });

  it('sorts groups by the newest createdAt when sortMode is createdAt', () => {
    const groups = groupInProgressOrders(
      [
        { id: 'old-reg', siteName: '古い登録', contractorName: 'A社', preferredDate: '2026-10-08', createdAt: '2026-09-01T00:00:00' },
        { id: 'new-reg', siteName: '新しい登録', contractorName: 'B社', preferredDate: '2026-07-13', createdAt: '2026-10-01T00:00:00' },
      ],
      { projectById: {}, today, sortMode: 'createdAt' },
    );
    expect(groups.map((group) => group.title)).toEqual(['新しい登録', '古い登録']);
  });

  it('puts orders with no contractor name and no contractor id into unknown', () => {
    const groups = groupInProgressOrders(
      [{ id: '1', siteName: '現場A', contractorName: '   ' }],
      { projectById: {} },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].key.startsWith('unknown|')).toBe(true);
  });
});
