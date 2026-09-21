/**
 * 种子脚本入口 —— 按预设编排各个模块。
 *
 *   npm run db:seed          演示数据：字典 + IMIP 楼栋 + 2500 人的完整模拟数据
 *   npm run db:seed:blank    空系统：只写通用字典 + 一个管理员账号 —— **开通新客户用这个**
 *
 * 模块分工：
 *   seed-lib.ts       共享随机数流与工具（跨模块必须共用同一个 rnd）
 *   seed-dict.ts      通用配置字典            ← 每个客户都要
 *   seed-imip.ts      IMIP 的部门与楼栋结构    ← 某一个客户自己的数据
 *   seed-demo.ts      模拟运营数据            ← 只给演示站和本地开发
 *   seed-platform.ts  集成平台占位与通知模板
 *
 * 新客户的楼栋房间走「系统 → 批量导入」的 Excel 模板录入，不要改 seed-imip。
 */
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/services/auth.js';
import { wipeAll } from './seed-lib.js';
import { seedDict, loadDict } from './seed-dict.js';
import { seedImipOrg, seedImipSpace } from './seed-imip.js';
import { seedDemo } from './seed-demo.js';

const prisma = new PrismaClient();
const BLANK = process.argv.includes('--blank');

/** 开通新客户时建的唯一账号。密码随机生成，只打印一次，且强制首次登录改密 */
async function seedAdmin() {
  const adminRole = await prisma.role.findFirst({ where: { code: 'ADMIN' } });
  if (!adminRole) throw new Error('字典里没有 ADMIN 角色，seedDict 没跑？');
  const password = crypto.randomBytes(9).toString('base64url');
  await prisma.user.create({
    data: {
      username: 'admin',
      name: '系统管理员',
      roleId: adminRole.id,
      passwordHash: hashPassword(password),
      mustChangePassword: true,
    },
  });
  return password;
}

async function main() {
  console.log('清空旧数据…');
  await wipeAll(prisma);

  console.log('写入配置字典…');
  await seedDict(prisma);

  if (BLANK) {
    const password = await seedAdmin();
    console.log('\n空系统已就绪。');
    console.log('  已写入通用字典：国籍 / 职级 / 班次 / 宗教 / 房型 18 种 / 物品 / 违规 / 工单类别 / 投诉类别 / 角色 / 排宿规则');
    console.log('  未写入任何楼栋、人员、运营数据');
    console.log('\n  管理员账号：admin');
    console.log(`  初始密码：  ${password}    ← 只显示这一次，首次登录强制改密`);
    console.log('\n  下一步：登录后到「系统 → 配置」改组织名称，再用「系统 → 批量导入」录入楼栋与人员。\n');
    return;
  }

  await seedImipOrg(prisma);
  const dict = await loadDict(prisma);
  const space = await seedImipSpace(prisma, dict);
  await seedDemo(prisma, dict, space);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
