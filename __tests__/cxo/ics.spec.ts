import { describe, expect, it } from 'vitest'
import { parseIcs, unfold, unescapeText, parseDuration, zonedToUtc } from '@/lib/ics'
import { normalizeIcsUrl, isPrivateIp, IcsUrlError } from '@/lib/icsFeeds'

const cal = (body: string, head = '') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${head}${body}END:VCALENDAR\r\n`
const ev = (lines: string[]) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT\r\n`
const W = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') }

describe('lexing', () => {
  it('unfolds continuation lines and unescapes text', () => {
    expect(unfold('SUMMARY:Long\r\n  title\r\nX:1')).toEqual(['SUMMARY:Long title', 'X:1'])
    expect(unescapeText('a\\, b\\; c\\nd\\\\e')).toBe('a, b; c\nd\\e')
  })
  it('reads durations', () => {
    expect(parseDuration('PT1H30M')).toBe(90 * 60_000)
    expect(parseDuration('P1D')).toBe(86_400_000)
    expect(parseDuration('P1W')).toBe(7 * 86_400_000)
    expect(parseDuration('nope')).toBeNull()
  })
  it('converts zoned wall time across DST', () => {
    expect(new Date(zonedToUtc({ y: 2026, m: 7, d: 1, hh: 9, mi: 0, ss: 0 }, 'America/New_York')).toISOString()).toBe('2026-07-01T13:00:00.000Z')
    expect(new Date(zonedToUtc({ y: 2026, m: 12, d: 1, hh: 9, mi: 0, ss: 0 }, 'America/New_York')).toISOString()).toBe('2026-12-01T14:00:00.000Z')
  })
})

describe('parseIcs', () => {
  it('reads all-day, UTC, TZID and folded events, and the calendar name', () => {
    const text = cal(
      ev(['UID:a', 'DTSTART;VALUE=DATE:20261126', 'DTEND;VALUE=DATE:20261127', 'SUMMARY:Thanksgiving Day']) +
        ev(['UID:b', 'DTSTART:20261015T170000Z', 'DTEND:20261015T180000Z', 'SUMMARY:Board call', 'LOCATION:Zoom\\, room 2']) +
        ev(['UID:c', 'DTSTART;TZID=America/Chicago:20261015T090000', 'DURATION:PT45M', 'SUMMARY:Stand', ' up']) +
        'BEGIN:VEVENT\r\nUID:d\r\nDTSTART:20261016T120000Z\r\nSUMMARY:Has alarm\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M\r\nSUMMARY:not me\r\nEND:VALARM\r\nEND:VEVENT\r\n',
      'X-WR-CALNAME:US Holidays\r\n',
    )
    const out = parseIcs(text, W)
    expect(out.name).toBe('US Holidays')
    const by = Object.fromEntries(out.events.map((e) => [e.uid, e]))
    expect(by.a).toMatchObject({ allDay: true, start: '2026-11-26', end: '2026-11-27', summary: 'Thanksgiving Day' })
    expect(by.b).toMatchObject({ allDay: false, start: '2026-10-15T17:00:00.000Z', end: '2026-10-15T18:00:00.000Z', location: 'Zoom, room 2' })
    expect(by.c).toMatchObject({ start: '2026-10-15T14:00:00.000Z', end: '2026-10-15T14:45:00.000Z', summary: 'Standup' })
    expect(by.d.summary).toBe('Has alarm')
  })

  it('uses X-WR-TIMEZONE for floating times', () => {
    const out = parseIcs(cal(ev(['UID:f', 'DTSTART:20261015T090000', 'SUMMARY:Floating']), 'X-WR-TIMEZONE:America/Los_Angeles\r\n'), W)
    expect(out.events[0].start).toBe('2026-10-15T16:00:00.000Z')
  })

  it('expands weekly RRULE with BYDAY, COUNT, and EXDATE, keeping wall time across DST', () => {
    const text = cal(
      ev([
        'UID:w',
        'DTSTART;TZID=America/New_York:20261026T090000',
        'DTEND;TZID=America/New_York:20261026T093000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5',
        'EXDATE;TZID=America/New_York:20261028T090000',
        'SUMMARY:Sync',
      ]),
    )
    const starts = parseIcs(text, W).events.map((e) => e.start)
    // Oct 26 (EDT), Oct 28 excluded, Nov 2 + Nov 4 (EST, still 9am local), Nov 9. COUNT counts the excluded one.
    expect(starts).toEqual(['2026-10-26T13:00:00.000Z', '2026-11-02T14:00:00.000Z', '2026-11-04T14:00:00.000Z', '2026-11-09T14:00:00.000Z'])
  })

  it('expands monthly by ordinal weekday and yearly all-day with UNTIL', () => {
    const text = cal(
      ev(['UID:m', 'DTSTART:20260105T150000Z', 'DURATION:PT1H', 'RRULE:FREQ=MONTHLY;BYDAY=1MO;UNTIL=20260430T000000Z', 'SUMMARY:First Monday']) +
        ev(['UID:y', 'DTSTART;VALUE=DATE:20200704', 'RRULE:FREQ=YEARLY', 'SUMMARY:Independence Day']) +
        ev(['UID:l', 'DTSTART;VALUE=DATE:20260130', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3', 'SUMMARY:Month end']) +
        ev(['UID:t', 'DTSTART;VALUE=DATE:20261126', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', 'SUMMARY:Thanksgiving']),
    )
    const out = parseIcs(text, W).events
    expect(out.filter((e) => e.uid === 'm').map((e) => e.start.slice(0, 10))).toEqual(['2026-01-05', '2026-02-02', '2026-03-02', '2026-04-06'])
    expect(out.filter((e) => e.uid === 'y').map((e) => e.start)).toEqual(['2026-07-04'])
    // DTSTART is always the first occurrence, then the last day of each month.
    expect(out.filter((e) => e.uid === 'l').map((e) => e.start)).toEqual(['2026-01-30', '2026-01-31', '2026-02-28'])
    expect(out.filter((e) => e.uid === 't').map((e) => e.start)).toEqual(['2026-11-26'])
  })

  it('applies RECURRENCE-ID overrides and drops cancelled events', () => {
    const text = cal(
      ev(['UID:r', 'DTSTART:20261001T140000Z', 'DTEND:20261001T150000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Daily']) +
        ev(['UID:r', 'RECURRENCE-ID:20261002T140000Z', 'DTSTART:20261002T180000Z', 'DTEND:20261002T190000Z', 'SUMMARY:Daily (moved)']) +
        ev(['UID:x', 'DTSTART:20261005T140000Z', 'STATUS:CANCELLED', 'SUMMARY:Gone']),
    )
    const out = parseIcs(text, W).events
    expect(out.map((e) => `${e.start}|${e.summary}`)).toEqual([
      '2026-10-01T14:00:00.000Z|Daily',
      '2026-10-02T18:00:00.000Z|Daily (moved)',
      '2026-10-03T14:00:00.000Z|Daily',
    ])
  })

  it('reaches the window for an old daily series and caps output', () => {
    const text = cal(ev(['UID:old', 'DTSTART:20050101T120000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Since 2005']))
    const out = parseIcs(text, { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-08T00:00:00Z') })
    expect(out.events.map((e) => e.start.slice(0, 10))).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'])
    const capped = parseIcs(cal(ev(['UID:many', 'DTSTART:20260101T120000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:x'])), W, { maxEvents: 50 })
    expect(capped.events).toHaveLength(50)
    expect(capped.truncated).toBe(true)
  })
})

describe('link safety', () => {
  it('rewrites webcal and refuses anything but https', () => {
    expect(normalizeIcsUrl('webcal://p01-caldav.icloud.com/published/2/abc')).toBe('https://p01-caldav.icloud.com/published/2/abc')
    expect(() => normalizeIcsUrl('http://example.com/a.ics')).toThrow(IcsUrlError)
    expect(() => normalizeIcsUrl('file:///etc/passwd')).toThrow(IcsUrlError)
    expect(() => normalizeIcsUrl('https://user:pw@example.com/a.ics')).toThrow(IcsUrlError)
    expect(() => normalizeIcsUrl('https://example.com:8443/a.ics')).toThrow(IcsUrlError)
  })
  it('blocks private addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPrivateIp(ip)).toBe(true)
    for (const ip of ['17.253.144.10', '8.8.8.8', '2606:4700::1111']) expect(isPrivateIp(ip)).toBe(false)
  })
})
