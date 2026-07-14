import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ImportService } from '@/lib/services/import.service'
import {
  createTestCompany,
  createTestGlAccount,
  createTestBankAccount,
  clearDatabase,
} from '../../helpers/factories'
import { db } from '@/lib/db'

const mockRunRuleEngineV2 = vi.fn()
vi.mock('@/lib/services/rule-engine-adapter', () => ({
  runRuleEngineV2: (...args: unknown[]) => mockRunRuleEngineV2(...args),
}))

describe('ImportService — V2 flag integration', () => {
  let company: Awaited<ReturnType<typeof createTestCompany>>
  let glAccount: Awaited<ReturnType<typeof createTestGlAccount>>
  let bankAccount: Awaited<ReturnType<typeof createTestBankAccount>>

  beforeEach(async () => {
    await clearDatabase()
    vi.clearAllMocks()
    vi.unstubAllEnvs()

    company = await createTestCompany('V2 Integration Test')
    glAccount = await createTestGlAccount({ companyId: company.id, code: '6000', name: 'Gastos' })
    bankAccount = await createTestBankAccount(company.id, glAccount.id)
  })

  afterEach(async () => {
    await clearDatabase()
    vi.unstubAllEnvs()
  })

  describe('RULE_ENGINE_V2_ENABLED=false (legacy)', () => {
    it('uses findMatchingRule and increments autoCategorizedCount', async () => {
      await db.bankRule.create({
        data: {
          companyId: company.id,
          name: 'Amazon',
          conditionType: 'contains',
          conditionValue: 'AMAZON',
          glAccountId: glAccount.id,
          priority: 10,
        },
      })

      const csvContent = 'date,description,amount\n2025-06-01,AMAZON PURCHASE,-45.99'
      const result = await ImportService.importFile({
        companyId: company.id,
        bankAccountId: bankAccount.id,
        fileName: 'test.csv',
        extension: 'csv',
        buffer: Buffer.from(''),
        content: csvContent,
      })

      expect(result.autoCategorizedCount).toBe(1)
      expect(result.transactionCount).toBe(1)

      const txs = await db.bankTransaction.findMany({
        where: { statement: { companyId: company.id } },
        select: { glAccountId: true, matchedRuleId: true },
      })
      expect(txs).toHaveLength(1)
      expect(txs[0]!.glAccountId).toBe(glAccount.id)
      expect(txs[0]!.matchedRuleId).not.toBeNull()
    })

    it('leaves glAccountId and matchedRuleId null when no rule matches', async () => {
      const csvContent = 'date,description,amount\n2025-06-01,COFFEE SHOP,-5.00'
      const result = await ImportService.importFile({
        companyId: company.id,
        bankAccountId: bankAccount.id,
        fileName: 'test.csv',
        extension: 'csv',
        buffer: Buffer.from(''),
        content: csvContent,
      })

      expect(result.autoCategorizedCount).toBe(0)

      const txs = await db.bankTransaction.findMany({
        where: { statement: { companyId: company.id } },
        select: { glAccountId: true, matchedRuleId: true },
      })
      expect(txs[0]!.glAccountId).toBeNull()
      expect(txs[0]!.matchedRuleId).toBeNull()
    })
  })

  describe('RULE_ENGINE_V2_ENABLED=true', () => {
    beforeEach(() => {
      vi.stubEnv('RULE_ENGINE_V2_ENABLED', 'true')
    })

    it('calls runRuleEngineV2 and maps matched outcome', async () => {
      const rule = await db.bankRule.create({
        data: {
          companyId: company.id,
          name: 'Amazon',
          conditionType: 'contains',
          conditionValue: 'AMAZON',
          glAccountId: glAccount.id,
          priority: 10,
        },
      })

      mockRunRuleEngineV2.mockResolvedValue({
        outcome: 'matched',
        classification: { glAccountId: glAccount.id },
        matchedRuleId: rule.id,
      })

      const csvContent = 'date,description,amount\n2025-06-01,AMAZON PURCHASE,-45.99'
      const result = await ImportService.importFile({
        companyId: company.id,
        bankAccountId: bankAccount.id,
        fileName: 'test.csv',
        extension: 'csv',
        buffer: Buffer.from(''),
        content: csvContent,
      })

      expect(result.autoCategorizedCount).toBe(1)
      expect(result.transactionCount).toBe(1)
      expect(mockRunRuleEngineV2).toHaveBeenCalledOnce()

      const txs = await db.bankTransaction.findMany({
        where: { statement: { companyId: company.id } },
        select: { glAccountId: true, matchedRuleId: true },
      })
      expect(txs).toHaveLength(1)
      expect(txs[0]!.glAccountId).toBe(glAccount.id)
      expect(txs[0]!.matchedRuleId).toBe(rule.id)
    })

    it('maps pending outcome as null glAccountId and matchedRuleId', async () => {
      mockRunRuleEngineV2.mockResolvedValue({ outcome: 'pending' })

      const csvContent = 'date,description,amount\n2025-06-01,AMAZON PURCHASE,-45.99'
      const result = await ImportService.importFile({
        companyId: company.id,
        bankAccountId: bankAccount.id,
        fileName: 'test.csv',
        extension: 'csv',
        buffer: Buffer.from(''),
        content: csvContent,
      })

      expect(result.autoCategorizedCount).toBe(0)

      const txs = await db.bankTransaction.findMany({
        where: { statement: { companyId: company.id } },
        select: { glAccountId: true, matchedRuleId: true },
      })
      expect(txs).toHaveLength(1)
      expect(txs[0]!.glAccountId).toBeNull()
      expect(txs[0]!.matchedRuleId).toBeNull()
    })

    it('passes bankAccountId and companyId to runRuleEngineV2', async () => {
      mockRunRuleEngineV2.mockResolvedValue({ outcome: 'pending' })

      const csvContent = 'date,description,amount\n2025-06-01,AMAZON PURCHASE,-45.99'
      await ImportService.importFile({
        companyId: company.id,
        bankAccountId: bankAccount.id,
        fileName: 'test.csv',
        extension: 'csv',
        buffer: Buffer.from(''),
        content: csvContent,
      })

      expect(mockRunRuleEngineV2).toHaveBeenCalledOnce()
      const args = mockRunRuleEngineV2.mock.calls[0]!
      expect(args[0]).toMatchObject({
        description: 'AMAZON PURCHASE',
        amount: -45.99,
        bankAccountId: bankAccount.id,
      })
      expect(args[3]).toBe(company.id)
    })
  })
})
