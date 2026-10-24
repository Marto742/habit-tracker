const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { todayInBulgaria, previousDay, lastDays, streak } = require('./days')

describe('streak', () => {
  test('no check-ins', () => {
    assert.equal(streak([], '2026-10-24'), 0)
  })

  test('only today', () => {
    assert.equal(streak(['2026-10-24'], '2026-10-24'), 1)
  })

  test('yesterday and the day before, not today yet: still counts, the day is not over', () => {
    assert.equal(streak(['2026-10-22', '2026-10-23'], '2026-10-24'), 2)
  })

  test('neither today nor yesterday: broken', () => {
    assert.equal(streak(['2026-10-21', '2026-10-22'], '2026-10-24'), 0)
  })

  test('a gap in the middle stops the count', () => {
    assert.equal(streak(['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-23', '2026-10-24'], '2026-10-24'), 3)
  })

  test('across 31.10 -> 1.11', () => {
    assert.equal(streak(['2026-10-30', '2026-10-31', '2026-11-01'], '2026-11-01'), 3)
  })

  test('across 25.10, which has 25 hours in Bulgaria', () => {
    assert.equal(streak(['2026-10-24', '2026-10-25', '2026-10-26'], '2026-10-26'), 3)
  })

  test('across the new year and a leap day', () => {
    assert.equal(streak(['2026-12-31', '2027-01-01'], '2027-01-01'), 2)
    assert.equal(streak(['2028-02-28', '2028-02-29', '2028-03-01'], '2028-03-01'), 3)
  })

  test('order and duplicates of the dates do not matter', () => {
    assert.equal(streak(['2026-10-24', '2026-10-22', '2026-10-23', '2026-10-24'], '2026-10-24'), 3)
  })
})

describe('previousDay', () => {
  test('steps back one calendar date', () => {
    assert.equal(previousDay('2026-11-01'), '2026-10-31')
    assert.equal(previousDay('2026-10-26'), '2026-10-25')
    assert.equal(previousDay('2026-10-25'), '2026-10-24')
    assert.equal(previousDay('2027-01-01'), '2026-12-31')
    assert.equal(previousDay('2028-03-01'), '2028-02-29')
    assert.equal(previousDay('2027-03-01'), '2027-02-28')
  })

  test('"yesterday" at 23:30 on 25.10 is 24.10, unlike "now minus 24 hours"', () => {
    const now = new Date('2026-10-25T21:30:00Z') // 23:30 in Bulgaria, after the clocks went back
    assert.equal(todayInBulgaria(now), '2026-10-25')
    assert.equal(todayInBulgaria(new Date(now - 24 * 60 * 60 * 1000)), '2026-10-25') // the trap
    assert.equal(previousDay(todayInBulgaria(now)), '2026-10-24')
  })
})

describe('todayInBulgaria', () => {
  test('uses Bulgarian time, not UTC', () => {
    assert.equal(todayInBulgaria(new Date('2026-10-24T22:30:00Z')), '2026-10-25') // 01:30 summer time
    assert.equal(todayInBulgaria(new Date('2026-12-31T23:30:00Z')), '2027-01-01') // 01:30 winter time
  })
})

describe('lastDays', () => {
  test('7 days up to today, oldest first', () => {
    assert.deepEqual(lastDays('2026-11-02', 7), [
      '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
    ])
  })
})
