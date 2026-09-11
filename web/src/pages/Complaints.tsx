import { useEffect, useState } from 'react';
import {
  Card, Table, Tag, Space, Select, Button, App, Drawer, Form, Input, Row, Col,
  Statistic, Alert, Descriptions, Timeline, Radio, Empty, Tooltip, Modal, Typography, Rate, Image,
} from 'antd';
import {
  EyeInvisibleOutlined, UserOutlined, WarningOutlined, SoundOutlined,
  PaperClipOutlined, TeamOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api';
import { useLang } from '../i18n';
import { useAuth } from '../auth';
import {
  useMeta, labelOf, SEVERITY_COLOR, PRIORITY_COLOR,
  COMPLAINT_STATUS_LABEL, COMPLAINT_STATUS_COLOR, COMPLAINT_ROUTE_LABEL,
} from '../meta';

/**
 * 投诉处理。
 *
 * 和违规页最大的不同：**这里的每一条都还只是一面之词。**
 * 所以流程被刻意拆成受理 → 核实 → 认定三步，认定成立才生成违规记录。
 * 界面上也一直提醒这一点，避免宿管顺手就当成已查实的事去扣分。
 */
export default function Complaints() {
  const { lang } = useLang();
  const meta = useMeta();
  const { can } = useAuth();
  const { message, modal } = App.useApp();

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Record<string, any>>({ open: 'true' });
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [hotRooms, setHotRooms] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [identity, setIdentity] = useState<any>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [form] = Form.useForm();

  const L = (k: string) => labelOf(COMPLAINT_STATUS_LABEL, k, lang);

  const load = () => {
    setLoading(true);
    api.complaints({ page, pageSize: 20, ...filters })
      .then((r) => { setRows(r.rows); setTotal(r.total); })
      .finally(() => setLoading(false));
  };
  const loadAside = () => {
    api.complaintStats().then(setStats).catch(() => {});
    api.complaintHotRooms().then(setHotRooms).catch(() => {});
  };
  useEffect(load, [page, JSON.stringify(filters)]);
  useEffect(loadAside, []);

  const setF = (k: string, v: any) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  const openDetail = async (id: number) => {
    setIdentity(null);
    const d = await api.complaint(id);
    setDetail(d);
  };
  const refreshAll = async (id?: number) => {
    load(); loadAside();
    if (id) await openDetail(id);
  };

  const doAccept = async (id: number) => {
    try { await api.acceptComplaint(id); message.success('已受理'); await refreshAll(id); }
    catch (e: any) { message.error(e.message); }
  };
  const doInvestigate = async (id: number) => {
    let note = '';
    modal.confirm({
      title: '开始核实',
      content: (
        <>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            核实记录默认<b>不对投诉人可见</b> —— 「已调取走廊监控」这类内容不该让他看到。
          </Typography.Paragraph>
          <Input.TextArea rows={3} placeholder="打算怎么核实？如：当晚 23:30 到现场查看"
            onChange={(e) => { note = e.target.value; }} />
        </>
      ),
      onOk: async () => {
        await api.investigateComplaint(id, note || undefined);
        message.success('已转入核实');
        await refreshAll(id);
      },
    });
  };

  /** 揭示匿名身份。二次确认 + 明确告知会留审计，这个摩擦是故意的 */
  const doReveal = (id: number) => {
    modal.confirm({
      title: '查看匿名投诉人身份',
      icon: <EyeInvisibleOutlined />,
      okText: '我确认需要查看',
      okButtonProps: { danger: true },
      content: (
        <Typography.Paragraph style={{ fontSize: 13, marginBottom: 0 }}>
          这是一条匿名投诉。查看投诉人身份仅用于<b>核实与回访</b>，
          <b>不得向被投诉方透露</b>。
          <br /><br />
          本次查看会连同你的账号、时间一起<b>记入审计日志</b>，且无法删除。
        </Typography.Paragraph>
      ),
      onOk: async () => {
        try {
          const r = await api.complaintIdentity(id);
          setIdentity(r);
          message.warning('身份已揭示，本次查看已记入审计');
        } catch (e: any) { message.error(e.message); }
      },
    });
  };

  const submitResolve = async () => {
    const v = await form.validateFields();
    try {
      const r = await api.resolveComplaint(detail.id, v);
      message.success(
        r.violationCodes?.length > 0
          ? `已认定，并开出违规单 ${r.violationCodes.join('、')}`
          : '已认定，结果已通知投诉人'
      );
      setResolveOpen(false);
      await refreshAll(detail.id);
    } catch (e: any) { message.error(e.message); }
  };

  const outcome = Form.useWatch('outcome', form);

  return (
    <>
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="投诉是一面之词，不是已认定的事实"
        description="走完「受理 → 核实 → 认定」才会生成违规记录。认定不成立也必须写清楚理由 —— 反映了没人给说法，下次就没人再用这个渠道。"
      />

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} sm={6}><Card size="small"><Statistic title="待办结" value={stats?.open ?? 0} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Statistic title="认定成立" value={stats?.substantiated ?? 0} valueStyle={{ color: '#3f8600' }} /></Card></Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Tooltip title="成立 ÷（成立 + 不成立）。太低说明渠道被滥用，太高说明核实走过场">
              <Statistic title="认定成立率" value={stats?.substantiatedRate ?? '—'} suffix={stats?.substantiatedRate != null ? '%' : ''} />
            </Tooltip>
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Tooltip title="匿名占比高是正常的 —— 实名投诉隔壁，第二天还要在同一层楼碰面">
              <Statistic title="匿名投诉" value={stats?.anonymousCount ?? 0} suffix={`/ ${stats?.total ?? 0}`} prefix={<EyeInvisibleOutlined />} />
            </Tooltip>
          </Card>
        </Col>
      </Row>

      {hotRooms.length > 0 && (
        <Card size="small" style={{ marginBottom: 12 }}
          title={<Space size={6}><TeamOutlined />被反复反映的房间</Space>}
          extra={<span style={{ fontSize: 12, color: '#8c8c8c' }}>按「不同投诉人数」排，不按条数 —— 条数会被一个人刷出来</span>}>
          <Space wrap size={8}>
            {hotRooms.slice(0, 12).map((r) => (
              <Tag key={r.roomId} color={r.singleSource ? 'default' : r.complainants >= 3 ? 'red' : 'orange'}
                style={{ padding: '3px 8px' }}>
                <b>{r.roomCode}</b> · {r.complainants} 人反映 / {r.count} 条
                {r.substantiated > 0 && <span> · 已成立 {r.substantiated}</span>}
                {r.singleSource && <span style={{ color: '#8c8c8c' }}> · 同一人重复投</span>}
              </Tag>
            ))}
          </Space>
        </Card>
      )}

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Radio.Group value={filters.open ?? ''} onChange={(e) => setF('open', e.target.value || undefined)}
            optionType="button" buttonStyle="solid" size="small"
            options={[{ label: '待办结', value: 'true' }, { label: '全部', value: '' }]} />
          <Select allowClear style={{ width: 190 }} placeholder="投诉类别"
            onChange={(v) => setF('typeId', v)}
            options={(meta.complaintTypes ?? []).map((t: any) => ({ value: t.id, label: t.nameZh }))} />
          <Select allowClear style={{ width: 140 }} placeholder="状态"
            onChange={(v) => setF('status', v)}
            options={(meta.complaintStatuses ?? []).map((s: string) => ({ value: s, label: L(s) }))} />
          <Select allowClear style={{ width: 130 }} placeholder="是否匿名"
            onChange={(v) => setF('anonymous', v)}
            options={[{ value: 'true', label: '匿名' }, { value: 'false', label: '实名' }]} />
          <Input.Search allowClear style={{ width: 200 }} placeholder="编号 / 房号 / 内容"
            onSearch={(v) => setF('q', v || undefined)} />
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="id" loading={loading} dataSource={rows}
          onRow={(r) => ({ onClick: () => openDetail(r.id), style: { cursor: 'pointer' } })}
          pagination={{ current: page, total, pageSize: 20, onChange: setPage, size: 'small', showTotal: (n) => `共 ${n} 条` }}
          columns={[
            { title: '编号', dataIndex: 'code', width: 104 },
            {
              title: '类别', dataIndex: 'type', width: 175,
              render: (v: any, r: any) => (
                <Space size={4} wrap>
                  <span>{v?.[lang] ?? v?.zh}</span>
                  {r.severity && <Tag color={SEVERITY_COLOR[r.severity]} style={{ marginInlineEnd: 0 }}>{r.severity}</Tag>}
                  {r.routeTo !== 'WARDEN' && (
                    <Tooltip title="不经本楼宿管，直达上级 —— 被投诉的可能就是宿管本人">
                      <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                        {labelOf(COMPLAINT_ROUTE_LABEL, r.routeTo, lang)}
                      </Tag>
                    </Tooltip>
                  )}
                </Space>
              ),
            },
            { title: '位置', dataIndex: 'location', width: 165, ellipsis: true },
            {
              title: '发生时间', dataIndex: 'occurredFrom', width: 140,
              render: (v: string, r: any) => (
                <Tooltip title={`提交于 ${dayjs(r.submittedAt).format('MM-DD HH:mm')}`}>
                  <span>{dayjs(v).format('MM-DD HH:mm')}</span>
                  {/* 噪音基本都发生在深夜，高亮一下，宿管一眼能看出该几点去蹲 */}
                  {(dayjs(v).hour() >= 22 || dayjs(v).hour() <= 5) && (
                    <Tag color="blue" style={{ marginLeft: 6 }}>深夜</Tag>
                  )}
                </Tooltip>
              ),
            },
            {
              title: '投诉人', dataIndex: 'complainant', width: 130,
              // 匿名投诉的姓名在列表里永远不出现，服务端就没返回。
              // 要看必须进详情点「查看身份」，那一下会写审计
              render: (v: any, r: any) =>
                r.anonymous
                  ? <Tag icon={<EyeInvisibleOutlined />} color="default">匿名</Tag>
                  : <Space size={4}><UserOutlined style={{ color: '#8c8c8c' }} />{v?.name ?? '—'}</Space>,
            },
            {
              title: '内容', dataIndex: 'description', ellipsis: true,
              render: (v: string, r: any) => (
                <Space size={4}>
                  {r.lang !== 'zh' && <Tag style={{ marginInlineEnd: 0 }}>{r.lang.toUpperCase()}</Tag>}
                  {r.attachmentCount > 0 && <Tag icon={<PaperClipOutlined />} style={{ marginInlineEnd: 0 }}>{r.attachmentCount}</Tag>}
                  <span>{v}</span>
                </Space>
              ),
            },
            {
              title: '状态', dataIndex: 'status', width: 110,
              render: (v: string, r: any) => (
                <Space size={4} direction="vertical" style={{ lineHeight: 1.3 }}>
                  <Tag color={COMPLAINT_STATUS_COLOR[v]} style={{ marginInlineEnd: 0 }}>{L(v)}</Tag>
                  {['NEW', 'ACCEPTED', 'INVESTIGATING'].includes(v) && r.deadline &&
                    dayjs().isAfter(r.deadline) && <Tag color="red" style={{ marginInlineEnd: 0 }}>已超时</Tag>}
                </Space>
              ),
            },
            {
              title: '优先级', dataIndex: 'priority', width: 84,
              render: (v: string) => <Tag color={PRIORITY_COLOR[v]}>{v}</Tag>,
            },
          ]}
        />
      </Card>

      {/* ============================== 详情抽屉 ============================== */}
      <Drawer
        open={!!detail} width={720} onClose={() => setDetail(null)}
        title={detail && <Space>{detail.code}<Tag color={COMPLAINT_STATUS_COLOR[detail.status]}>{L(detail.status)}</Tag></Space>}
        extra={detail && can('complaint:write') && (
          <Space>
            {detail.status === 'NEW' && <Button type="primary" onClick={() => doAccept(detail.id)}>受理</Button>}
            {['ACCEPTED'].includes(detail.status) && <Button onClick={() => doInvestigate(detail.id)}>开始核实</Button>}
            {['ACCEPTED', 'INVESTIGATING'].includes(detail.status) && (
              <Button type="primary" onClick={() => { form.resetFields(); setResolveOpen(true); }}>认定结果</Button>
            )}
            {['SUBSTANTIATED', 'UNSUBSTANTIATED'].includes(detail.status) && (
              <Button onClick={async () => { await api.closeComplaint(detail.id); message.success('已归档'); await refreshAll(detail.id); }}>归档</Button>
            )}
          </Space>
        )}
      >
        {detail && (
          <>
            {detail.distinctComplainants >= 3 && (
              <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                message={`同一时段有 ${detail.distinctComplainants} 个不同的人反映这间房`}
                description="多人独立反映，可信度明显高于单人投诉，建议优先处理。" />
            )}
            {detail.related?.length > 0 && detail.distinctComplainants < 3 && (
              <Alert type="info" showIcon style={{ marginBottom: 12 }}
                message={`另有 ${detail.related.length} 条投诉指向同一房间`}
                description="如果确认是同一件事，可以在下面合并，原始记录不会丢。" />
            )}

            <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}
              items={[
                { label: '类别', children: <Space size={4}>{detail.type?.[lang] ?? detail.type?.zh}<Tag color={SEVERITY_COLOR[detail.severity]}>{detail.severity}</Tag></Space> },
                { label: '派发', children: labelOf(COMPLAINT_ROUTE_LABEL, detail.routeTo, lang) },
                { label: '位置', children: detail.location, span: 2 },
                {
                  label: '发生时段', span: 2,
                  children: (
                    <Space size={4}>
                      <b>{dayjs(detail.occurredFrom).format('YYYY-MM-DD HH:mm')}</b>
                      {detail.occurredTo && <span>— {dayjs(detail.occurredTo).format('HH:mm')}</span>}
                      <span style={{ color: '#8c8c8c', fontSize: 12 }}>
                        （提交于 {dayjs(detail.submittedAt).format('MM-DD HH:mm')}）
                      </span>
                    </Space>
                  ),
                },
                {
                  label: '投诉人', span: 2,
                  children: detail.anonymous ? (
                    <Space>
                      <Tag icon={<EyeInvisibleOutlined />}>匿名提交</Tag>
                      {identity ? (
                        <Space size={4}>
                          <b>{identity.name}</b>
                          <span style={{ color: '#8c8c8c' }}>{identity.employeeNo} · {identity.roomCode ?? '—'}</span>
                        </Space>
                      ) : detail.canReveal ? (
                        <Button size="small" danger icon={<EyeInvisibleOutlined />} onClick={() => doReveal(detail.id)}>
                          查看身份（会记审计）
                        </Button>
                      ) : (
                        <span style={{ color: '#8c8c8c', fontSize: 12 }}>
                          你没有查看匿名投诉人身份的权限
                        </span>
                      )}
                    </Space>
                  ) : (
                    <Space size={4}>
                      {detail.complainant?.name}
                      <span style={{ color: '#8c8c8c' }}>
                        {detail.complainant?.employeeNo} · {detail.complainant?.department ?? '—'} · {detail.complainant?.roomCode ?? '—'}
                      </span>
                    </Space>
                  ),
                },
                { label: '内容', span: 2, children: <span>{detail.description || '—'}</span> },
                ...(detail.resolution ? [{ label: '认定结论', span: 2, children: detail.resolution }] : []),
                ...(detail.rating ? [{ label: '投诉人评价', span: 2, children: <Space><Rate disabled value={detail.rating} style={{ fontSize: 14 }} />{detail.ratingComment}</Space> }] : []),
              ]}
            />

            {identity && (
              <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                message="你正在查看匿名投诉人的身份" description={identity.warning} />
            )}

            {detail.attachments?.length > 0 && (
              <Card size="small" title={<Space size={6}><PaperClipOutlined />现场证据</Space>} style={{ marginBottom: 12 }}>
                <Space wrap>
                  {detail.attachments.map((a: any) =>
                    a.kind === 'PHOTO' ? (
                      <Image key={a.id} src={a.url} width={110} height={110}
                        style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ) : (
                      <Space key={a.id} direction="vertical" size={2}>
                        <Space size={4} style={{ fontSize: 12, color: '#8c8c8c' }}><SoundOutlined />录音</Space>
                        <audio controls src={a.url} style={{ height: 32 }} />
                      </Space>
                    )
                  )}
                </Space>
              </Card>
            )}

            {detail.occupants?.length > 0 && (
              <Card size="small" title="被投诉房间此刻住了谁" style={{ marginBottom: 12 }}
                extra={<span style={{ fontSize: 12, color: '#8c8c8c' }}>由系统按在住记录反查，投诉人并没有指认任何人</span>}>
                <Space wrap size={6}>
                  {detail.occupants.map((o: any) => (
                    <Tag key={o.personId}>{o.name} · {o.bedCode}{o.department ? ` · ${o.department}` : ''}</Tag>
                  ))}
                </Space>
              </Card>
            )}

            <Card size="small" title="处理流水">
              <Timeline
                items={(detail.events ?? []).map((e: any) => ({
                  color: e.type === 'RESOLVE' ? 'green' : e.type === 'REVEAL_IDENTITY' ? 'red' : 'blue',
                  children: (
                    <div style={{ fontSize: 13 }}>
                      <Space size={6}>
                        <b>{EVENT_LABEL[e.type] ?? e.type}</b>
                        <span style={{ color: '#8c8c8c', fontSize: 12 }}>{e.operator}</span>
                        <span style={{ color: '#bfbfbf', fontSize: 12 }}>{dayjs(e.createdAt).format('MM-DD HH:mm')}</span>
                        {!e.visibleToComplainant && <Tag style={{ fontSize: 11 }}>内部</Tag>}
                      </Space>
                      {e.note && <div style={{ color: '#595959' }}>{e.note}</div>}
                    </div>
                  ),
                }))}
              />
              {(detail.events ?? []).length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </Card>
          </>
        )}
      </Drawer>

      {/* ============================== 认定弹窗 ============================== */}
      <Modal
        open={resolveOpen} title="认定结果" onCancel={() => setResolveOpen(false)}
        onOk={submitResolve} okText="提交认定" width={560}
      >
        <Form form={form} layout="vertical" initialValues={{ outcome: 'SUBSTANTIATED' }}>
          <Form.Item name="outcome" label="结论" rules={[{ required: true }]}>
            <Radio.Group optionType="button" buttonStyle="solid"
              options={[
                { label: '认定成立', value: 'SUBSTANTIATED' },
                { label: '认定不成立', value: 'UNSUBSTANTIATED' },
                { label: '重复投诉', value: 'DUPLICATE' },
              ]} />
          </Form.Item>

          <Form.Item name="resolution" label="认定说明"
            extra="这段话会原样发给投诉人。不成立也要说清楚做了什么核实、为什么不成立。"
            rules={[{ required: true, message: '必须写认定说明' }]}>
            <Input.TextArea rows={3} placeholder="如：当晚 23:30 到现场核实，确有多人聚集饮酒，已当面提醒并记录违规。" />
          </Form.Item>

          {outcome === 'SUBSTANTIATED' && (
            <>
              <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                message="下面选了人才会真的扣分罚款"
                description="不选人也可以只在房间上记一条 —— 找不到具体责任人时这很常见。" />
              <Form.Item name="violationTypeId" label="转为哪种违规"
                extra="留空则不生成违规记录，只把投诉标为成立">
                <Select allowClear placeholder="选择违规类型"
                  options={meta.violationTypes.map((v: any) => ({
                    value: v.id, label: `${v.nameZh}（扣 ${v.defaultPoints} 分${v.defaultFine > 0 ? ` / 罚 ${v.defaultFine}` : ''}）`,
                  }))} />
              </Form.Item>
              <Form.Item name="violationPersonIds" label="责任人"
                extra="从被投诉房间此刻的在住名单里选，可多选">
                <Select mode="multiple" allowClear placeholder="不选 = 只在房间上记录"
                  options={(detail?.occupants ?? []).map((o: any) => ({
                    value: o.personId, label: `${o.name}（${o.employeeNo} · ${o.bedCode}）`,
                  }))} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}

const EVENT_LABEL: Record<string, string> = {
  SUBMIT: '提交', ACCEPT: '受理', INVESTIGATE: '核实', RESOLVE: '认定',
  CLOSE: '归档', COMMENT: '备注', MERGE: '合并', WITHDRAW: '撤回',
  REVEAL_IDENTITY: '查看了匿名投诉人身份', RATE: '投诉人评价',
};
