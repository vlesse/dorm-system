import { useEffect, useMemo, useState } from 'react';
import {
  Card, Tabs, Table, Tag, Space, Button, Upload, Alert, App, Typography,
  Row, Col, Statistic, Modal, Segmented, Empty, Divider,
} from 'antd';
import { DownloadOutlined, UploadOutlined, CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { api } from '../api';
import { useAuth } from '../auth';

/**
 * 人工批量导入。
 *
 * 和「集成对接 → 人员同步」并行：系统对接不上、或者还没对接时，
 * 拿 Excel / CSV 也能把数据灌进来，最后都落到同一张同步日志。
 *
 * 模板由后端的字段定义在前端现生成 —— 字段说明、模板表头、后端校验
 * 读的是同一份定义，不会出现「模板里有这列、导入却说不认识」。
 */

const STATUS_META: Record<string, { color: string; label: string }> = {
  CREATE: { color: 'green', label: '新增' },
  UPDATE: { color: 'blue', label: '更新' },
  ERROR: { color: 'red', label: '有错' },
};

export default function ImportData() {
  const { message, modal } = App.useApp();
  const { can } = useAuth();
  const [schema, setSchema] = useState<any>(null);
  const [type, setType] = useState('persons');
  const [rows, setRows] = useState<any[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'CREATE' | 'UPDATE' | 'ERROR'>('ALL');

  const loadLogs = () => api.syncLogs().then(setLogs).catch(() => {});
  useEffect(() => { api.importSchema().then(setSchema); loadLogs(); }, []);
  useEffect(() => { setRows(null); setResults(null); setFileName(''); }, [type]);

  const def = useMemo(() => schema?.types.find((t: any) => t.type === type), [schema, type]);

  if (!schema) return <Card size="small" loading />;

  const dictOptions = (name?: string) => (name ? schema.dicts[name] ?? [] : []);

  // ---------------- 模板生成 ----------------
  const templateRows = () => {
    const header = def.fields.map((f: any) => f.label + (f.required ? ' *' : ''));
    const example = def.fields.map((f: any) => f.example ?? '');
    return [header, example];
  };

  const downloadCsv = () => {
    const data = templateRows();
    const csv = data.map((r) => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `导入模板_${def.nameZh}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadXlsx = () => {
    const wb = XLSX.utils.book_new();
    // 第一个表：数据（表头 + 示例行）
    const ws = XLSX.utils.aoa_to_sheet(templateRows());
    ws['!cols'] = def.fields.map((f: any) => ({ wch: Math.max(10, f.label.length * 2 + 4) }));
    XLSX.utils.book_append_sheet(wb, ws, '数据');

    // 第二个表：字段说明 + 可选值 —— 填表的人不用来回问
    const help = [['字段', '是否必填', '可选值 / 格式', '说明']];
    for (const f of def.fields) {
      const opts = dictOptions(f.dict);
      help.push([
        f.label,
        f.required ? '必填' : '选填',
        opts.length ? opts.join(' / ') : (f.example ? `示例：${f.example}` : ''),
        f.hint ?? '',
      ]);
    }
    const wsHelp = XLSX.utils.aoa_to_sheet(help);
    wsHelp['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 60 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, wsHelp, '填写说明');

    XLSX.writeFile(wb, `导入模板_${def.nameZh}.xlsx`);
  };

  // ---------------- 文件解析 ----------------
  const parseFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false, raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    if (aoa.length < 2) throw new Error('文件里没有数据行（第一行应是表头）');

    // 表头按「去掉星号后的中文标签」映射回字段 key
    const header = aoa[0].map((h: any) => String(h ?? '').replace(/\*/g, '').trim());
    const keyByCol: (string | null)[] = header.map((h) => {
      const f = def.fields.find((x: any) => x.label === h || x.key === h);
      return f ? f.key : null;
    });
    const unknown = header.filter((h, i) => h && !keyByCol[i]);

    const out: any[] = [];
    for (const line of aoa.slice(1)) {
      const obj: any = {};
      let empty = true;
      line.forEach((cell: any, i: number) => {
        const k = keyByCol[i];
        if (!k) return;
        const v = String(cell ?? '').trim();
        obj[k] = v;
        if (v) empty = false;
      });
      if (!empty) out.push(obj);
    }
    return { rows: out, unknown };
  };

  const onFile = async (file: File) => {
    try {
      const { rows: parsed, unknown } = await parseFile(file);
      if (parsed.length === 0) return message.warning('没有解析到任何数据行');
      setRows(parsed);
      setFileName(file.name);
      setResults(null);
      if (unknown.length) {
        message.warning(`有 ${unknown.length} 列表头无法识别，已忽略：${unknown.join('、')}`);
      } else {
        message.success(`已读取 ${parsed.length} 行，请点「预检」`);
      }
    } catch (e: any) {
      message.error(`解析失败：${e.message}`);
    }
    return false;
  };

  const preview = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const r = await api.importPreview(type, rows);
      setResults(r.results);
      const bad = r.results.filter((x: any) => x.status === 'ERROR').length;
      if (bad) { setFilter('ERROR'); message.warning(`预检完成：${bad} 行有问题，请先看红色的行`); }
      else message.success('预检通过，可以导入');
    } catch (e: any) {
      message.error(e.message);
    } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!results) return;
    const bad = results.filter((r) => r.status === 'ERROR').length;
    const good = results.length - bad;
    modal.confirm({
      title: '确认导入',
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
          将导入 <b>{good}</b> 行{bad > 0 && <>，跳过 <b style={{ color: '#cf1322' }}>{bad}</b> 行有错的</>}。<br />
          {type === 'persons' && '已存在的工号会被更新；标记为「已离职」且仍占床位的人会自动生成退宿待办。'}
          {type === 'rooms' && '不存在的楼栋和楼层会自动创建，新建房间会按房型自动摆好床位。'}
          {type === 'occupancy' && '会真正占用床位并留下入住记录，操作可在审计日志里追溯。'}
        </div>
      ),
      okText: `导入 ${good} 行`,
      onOk: async () => {
        setBusy(true);
        try {
          const r = await api.importCommit(type, rows!, true);
          Modal.success({
            title: '导入完成',
            content: (
              <div style={{ fontSize: 13, lineHeight: 2 }}>
                新增 <b>{r.created}</b> 行 · 更新 <b>{r.updated}</b> 行<br />
                {r.deactivated > 0 && <>触发退宿待办 <b>{r.deactivated}</b> 条<br /></>}
                {r.skipped > 0 && <>跳过有错的 <b>{r.skipped}</b> 行<br /></>}
                {r.failed > 0 && <span style={{ color: '#cf1322' }}>写入失败 {r.failed} 行<br /></span>}
                {r.message && <span style={{ color: '#8c8c8c', fontSize: 12 }}>{r.message}</span>}
              </div>
            ),
          });
          setRows(null); setResults(null); setFileName('');
          loadLogs();
        } catch (e: any) {
          message.error(e.message);
        } finally { setBusy(false); }
      },
    });
  };

  const counts = results
    ? {
        create: results.filter((r) => r.status === 'CREATE').length,
        update: results.filter((r) => r.status === 'UPDATE').length,
        error: results.filter((r) => r.status === 'ERROR').length,
        warn: results.filter((r) => r.status !== 'ERROR' && r.warnings.length > 0).length,
      }
    : null;

  const shown = results?.filter((r) => filter === 'ALL' || r.status === filter) ?? [];

  const fieldTable = (
    <Table
      size="small" rowKey="key" pagination={false} dataSource={def.fields}
      columns={[
        {
          title: '列名（模板表头）', dataIndex: 'label', width: 170,
          render: (v: string, f: any) => (
            <span>{v} {f.required && <Tag color="red" style={{ marginInlineStart: 4 }}>必填</Tag>}</span>
          ),
        },
        {
          title: '可选值 / 格式', width: 380,
          render: (_: any, f: any) => {
            const opts = dictOptions(f.dict);
            if (opts.length === 0) return <span style={{ color: '#8c8c8c' }}>{f.example ? `示例：${f.example}` : '自由填写'}</span>;
            return (
              <Space size={[4, 4]} wrap>
                {opts.slice(0, 12).map((o: string) => <Tag key={o} style={{ marginInlineEnd: 0 }}>{o}</Tag>)}
                {opts.length > 12 && <span style={{ color: '#8c8c8c' }}>等 {opts.length} 项</span>}
              </Space>
            );
          },
        },
        { title: '说明', dataIndex: 'hint', render: (v: string) => <span style={{ color: '#8c8c8c' }}>{v}</span> },
      ]}
    />
  );

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert
        type="info" showIcon
        message="除了系统对接，也可以人工拿 Excel 批量导入"
        description={
          <div style={{ fontSize: 12, lineHeight: 1.9 }}>
            流程是<b>下载模板 → 填数据 → 上传 → 预检 → 确认导入</b>。
            预检不写库，会逐行告诉你是新增还是更新、哪行有问题、问题是什么；
            有错的行可以跳过，不必整批重来。导入记录和系统同步一起进「集成对接 → 人员同步」的日志。
          </div>
        }
      />

      <Card size="small" styles={{ body: { paddingTop: 8 } }}>
        <Tabs
          activeKey={type} onChange={setType} size="small"
          items={schema.types.map((t: any) => ({ key: t.type, label: t.nameZh }))}
        />

        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={def.desc} />

        {/* 步骤一：模板 */}
        <Divider orientation="left" plain style={{ margin: '4px 0 12px' }}>
          <span style={{ fontSize: 13 }}>① 下载模板</span>
        </Divider>
        <Space wrap style={{ marginBottom: 8 }}>
          <Button type="primary" icon={<DownloadOutlined />} onClick={downloadXlsx}>
            下载 Excel 模板（含填写说明）
          </Button>
          <Button icon={<DownloadOutlined />} onClick={downloadCsv}>下载 CSV 模板</Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Excel 模板里第二个表页「填写说明」列了每个字段的可选值，照着填不会错。
          </Typography.Text>
        </Space>
        {fieldTable}

        {/* 步骤二：上传 */}
        <Divider orientation="left" plain style={{ margin: '16px 0 12px' }}>
          <span style={{ fontSize: 13 }}>② 上传并预检</span>
        </Divider>
        <Space wrap>
          <Upload accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={onFile}>
            <Button icon={<UploadOutlined />}>选择文件（.xlsx / .csv）</Button>
          </Upload>
          {fileName && <Tag color="blue">{fileName} · {rows?.length ?? 0} 行</Tag>}
          <Button type="primary" disabled={!rows} loading={busy} onClick={preview}>预检</Button>
          {rows && (
            <Button icon={<ReloadOutlined />} onClick={() => { setRows(null); setResults(null); setFileName(''); }}>
              重选
            </Button>
          )}
        </Space>

        {/* 步骤三：结果 */}
        {results && (
          <>
            <Divider orientation="left" plain style={{ margin: '16px 0 12px' }}>
              <span style={{ fontSize: 13 }}>③ 确认导入</span>
            </Divider>
            <Row gutter={12} style={{ marginBottom: 12 }}>
              <Col span={5}><Card size="small"><Statistic title="新增" value={counts!.create} valueStyle={{ color: '#52c41a' }} /></Card></Col>
              <Col span={5}><Card size="small"><Statistic title="更新" value={counts!.update} valueStyle={{ color: '#1677ff' }} /></Card></Col>
              <Col span={5}><Card size="small"><Statistic title="有错（会跳过）" value={counts!.error} valueStyle={{ color: counts!.error ? '#cf1322' : undefined }} /></Card></Col>
              <Col span={5}><Card size="small"><Statistic title="有提醒" value={counts!.warn} valueStyle={{ color: counts!.warn ? '#fa8c16' : undefined }} /></Card></Col>
              <Col span={4}>
                <Card size="small" styles={{ body: { display: 'flex', alignItems: 'center', height: '100%' } }}>
                  <Button type="primary" icon={<CheckCircleOutlined />} loading={busy}
                    disabled={!can(def.perm) || counts!.create + counts!.update === 0}
                    onClick={commit}>
                    确认导入
                  </Button>
                </Card>
              </Col>
            </Row>

            {!can(def.perm) && (
              <Alert type="error" showIcon style={{ marginBottom: 12 }}
                message={`当前账号没有「${def.perm}」权限，只能预检不能导入`} />
            )}

            <Space style={{ marginBottom: 8 }}>
              <Segmented
                size="small" value={filter} onChange={(v) => setFilter(v as any)}
                options={[
                  { label: `全部 ${results.length}`, value: 'ALL' },
                  { label: `新增 ${counts!.create}`, value: 'CREATE' },
                  { label: `更新 ${counts!.update}`, value: 'UPDATE' },
                  { label: `有错 ${counts!.error}`, value: 'ERROR' },
                ]}
              />
            </Space>

            {shown.length === 0 ? <Empty description="没有符合筛选的行" /> : (
              <Table
                size="small" rowKey="line" dataSource={shown}
                pagination={{ pageSize: 20, size: 'small', showTotal: (n) => `共 ${n} 行` }}
                rowClassName={(r: any) => (r.status === 'ERROR' ? 'row-danger' : '')}
                columns={[
                  { title: '行号', dataIndex: 'line', width: 70 },
                  {
                    title: '结果', dataIndex: 'status', width: 90,
                    render: (v: string) => <Tag color={STATUS_META[v].color}>{STATUS_META[v].label}</Tag>,
                  },
                  { title: '内容', dataIndex: 'label', width: 240 },
                  {
                    title: '问题 / 提醒',
                    render: (_: any, r: any) => (
                      <Space direction="vertical" size={0}>
                        {r.errors.map((e: string, i: number) => (
                          <span key={`e${i}`} style={{ color: '#cf1322', fontSize: 12 }}>✕ {e}</span>
                        ))}
                        {r.warnings.map((w: string, i: number) => (
                          <span key={`w${i}`} style={{ color: '#d46b08', fontSize: 12 }}>! {w}</span>
                        ))}
                        {r.errors.length === 0 && r.warnings.length === 0 && (
                          <span style={{ color: '#52c41a', fontSize: 12 }}>✓ 无问题</span>
                        )}
                      </Space>
                    ),
                  },
                ]}
              />
            )}
          </>
        )}
      </Card>

      <Card size="small" title="导入 / 同步记录" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="id" dataSource={logs} pagination={{ pageSize: 8, size: 'small' }}
          columns={[
            { title: '来源', dataIndex: 'provider', width: 110,
              render: (v: string) => <Tag color={v === 'MANUAL' ? 'blue' : 'default'}>{v === 'MANUAL' ? '人工导入' : v}</Tag> },
            { title: '类型', dataIndex: 'kind', width: 110 },
            { title: '时间', dataIndex: 'startedAt', width: 170, render: (v: string) => new Date(v).toLocaleString() },
            { title: '操作人', dataIndex: 'operator', width: 120 },
            { title: '状态', dataIndex: 'status', width: 90,
              render: (v: string) => <Tag color={v === 'SUCCESS' ? 'green' : v === 'FAILED' ? 'red' : 'blue'}>{v}</Tag> },
            { title: '新增', dataIndex: 'created', width: 70, align: 'right' },
            { title: '更新', dataIndex: 'updated', width: 70, align: 'right' },
            { title: '触发退宿', dataIndex: 'deactivated', width: 90, align: 'right',
              render: (v: number) => (v ? <Tag color="orange">{v}</Tag> : '—') },
            { title: '备注', dataIndex: 'message', ellipsis: true },
          ]}
        />
      </Card>
    </Space>
  );
}
