import { useEffect, useState } from 'react';
import {
  Card, Table, Tag, Space, Select, Button, App, Drawer, Form, Input, Row, Col,
  Statistic, Alert, Descriptions, Timeline, Radio, Empty, Tooltip, Modal, Typography, Rate, Image,
} from 'antd';
import {
  EyeInvisibleOutlined, UserOutlined, SoundOutlined, PaperClipOutlined, TeamOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, fetchBlob } from '../api';
import { useLang, useT, useFmt, useDictName } from '../i18n';
import { useAuth } from '../auth';
import {
  useMeta, labelOf, SEVERITY_COLOR, PRIORITY_COLOR, SEVERITY_LABEL, PRIORITY_LABEL,
  COMPLAINT_STATUS_LABEL, COMPLAINT_STATUS_COLOR, COMPLAINT_ROUTE_LABEL,
} from '../meta';

/**
 * 投诉处理。
 *
 * 和违规页最大的不同：**这里的每一条都还只是一面之词。**
 * 所以流程被刻意拆成受理 → 核实 → 认定三步，认定成立才生成违规记录。
 * 界面上也一直提醒这一点，避免宿管顺手就当成已查实的事去扣分。
 *
 * 宿管队伍里有印尼籍，这页的文案全部走 i18n（cp_ 前缀）。
 * 服务端返回的位置、流水备注等仍是中文，和系统其它页面一致。
 */
export default function Complaints() {
  const { lang } = useLang();
  const t = useT();
  const f = useFmt();
  const dn = useDictName();
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
  const [comment, setComment] = useState('');
  const [commentPublic, setCommentPublic] = useState(false);
  const [form] = Form.useForm();

  const L = (k: string) => labelOf(COMPLAINT_STATUS_LABEL, k, lang);
  const typeName = (v: any) => v?.[lang] ?? v?.zh;

  const load = () => {
    setLoading(true);
    api.complaints({ page, pageSize: 20, ...filters })
      .then((r) => { setRows(r.rows); setTotal(r.total); })
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  };
  const loadAside = () => {
    api.complaintStats().then(setStats).catch(() => {});
    api.complaintHotRooms().then(setHotRooms).catch(() => {});
  };
  useEffect(load, [page, JSON.stringify(filters)]);
  useEffect(loadAside, []);

  const setF = (k: string, v: any) => { setPage(1); setFilters((x) => ({ ...x, [k]: v })); };

  const openDetail = async (id: number) => {
    setIdentity(null);
    setComment('');
    try {
      setDetail(await api.complaint(id));
    } catch (e: any) { message.error(e.message); }
  };
  const refreshAll = async (id?: number) => {
    load(); loadAside();
    if (id) await openDetail(id);
  };

  const doAccept = async (id: number) => {
    try { await api.acceptComplaint(id); message.success(t('cp_accepted')); await refreshAll(id); }
    catch (e: any) { message.error(e.message); }
  };
  const doInvestigate = async (id: number) => {
    let note = '';
    modal.confirm({
      title: t('cp_investigate'),
      content: (
        <>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>{t('cp_investigate_hint')}</Typography.Paragraph>
          <Input.TextArea rows={3} placeholder={t('cp_investigate_ph')}
            onChange={(e) => { note = e.target.value; }} />
        </>
      ),
      onOk: async () => {
        try {
          await api.investigateComplaint(id, note || undefined);
          message.success(t('cp_investigating'));
          await refreshAll(id);
        } catch (e: any) { message.error(e.message); }
      },
    });
  };

  /** 揭示匿名身份。二次确认 + 明确告知会留审计，这个摩擦是故意的 */
  const doReveal = (id: number) => {
    modal.confirm({
      title: t('cp_reveal_title'),
      icon: <EyeInvisibleOutlined />,
      okText: t('cp_reveal_ok'),
      okButtonProps: { danger: true },
      content: (
        <Typography.Paragraph style={{ fontSize: 13, marginBottom: 0 }}>
          <b>{t('cp_reveal_body1')}</b>
          <br /><br />
          {t('cp_reveal_body2')}
        </Typography.Paragraph>
      ),
      onOk: async () => {
        try {
          const r = await api.complaintIdentity(id);
          setIdentity(r);
          message.warning(t('cp_revealed'));
        } catch (e: any) { message.error(e.message); }
      },
    });
  };

  /** 打开认定弹窗：违规类型预填成该投诉类别的默认违规类型，处理人可以改、也可以清空（清空 = 不开违规单） */
  const openResolve = () => {
    form.resetFields();
    const ct = (meta.complaintTypes ?? []).find((x: any) => x.id === detail.typeId);
    form.setFieldsValue({ outcome: 'SUBSTANTIATED', violationTypeId: ct?.violationTypeId ?? undefined });
    setResolveOpen(true);
  };

  const doMerge = (into: any) => {
    modal.confirm({
      title: f('cp_merge_title', { a: detail.code, b: into.code }),
      content: t('cp_merge_body'),
      onOk: async () => {
        try { await api.mergeComplaint(detail.id, into.id); message.success(t('cp_merged')); await refreshAll(detail.id); }
        catch (e: any) { message.error(e.message); }
      },
    });
  };

  const doComment = async () => {
    if (!comment.trim()) return;
    try {
      await api.commentComplaint(detail.id, comment.trim(), commentPublic);
      setComment('');
      message.success(commentPublic ? t('cp_comment_public_ok') : t('cp_comment_internal_ok'));
      await openDetail(detail.id);
    } catch (e: any) { message.error(e.message); }
  };

  const doClose = async () => {
    try { await api.closeComplaint(detail.id); message.success(t('cp_archived')); await refreshAll(detail.id); }
    catch (e: any) { message.error(e.message); }
  };

  const submitResolve = async () => {
    const v = await form.validateFields();
    try {
      const r = await api.resolveComplaint(detail.id, v);
      message.success(
        r.violationCodes?.length > 0
          ? f('cp_resolved_vio', { codes: r.violationCodes.join(', ') })
          : t('cp_resolved')
      );
      setResolveOpen(false);
      await refreshAll(detail.id);
    } catch (e: any) { message.error(e.message); }
  };

  const outcome = Form.useWatch('outcome', form);
  const muted = { fontSize: 12, color: '#8c8c8c' };

  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message={t('cp_banner')} description={t('cp_banner_desc')} />

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} sm={6}><Card size="small"><Statistic title={t('cp_open')} value={stats?.open ?? 0} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Statistic title={t('cp_substantiated')} value={stats?.substantiated ?? 0} valueStyle={{ color: '#3f8600' }} /></Card></Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Tooltip title={t('cp_rate_tip')}>
              <Statistic title={t('cp_rate')} value={stats?.substantiatedRate ?? '—'} suffix={stats?.substantiatedRate != null ? '%' : ''} />
            </Tooltip>
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Tooltip title={t('cp_anonymous_tip')}>
              <Statistic title={t('cp_anonymous_count')} value={stats?.anonymousCount ?? 0} suffix={`/ ${stats?.total ?? 0}`} prefix={<EyeInvisibleOutlined />} />
            </Tooltip>
          </Card>
        </Col>
      </Row>

      {hotRooms.length > 0 && (
        <Card size="small" style={{ marginBottom: 12 }}
          title={<Space size={6}><TeamOutlined />{t('cp_hot')}</Space>}
          extra={<span style={muted}>{t('cp_hot_tip')}</span>}>
          <Space wrap size={8}>
            {hotRooms.slice(0, 12).map((r) => (
              <Tag key={r.roomId} color={r.singleSource ? 'default' : r.complainants >= 3 ? 'red' : 'orange'}
                style={{ padding: '3px 8px' }}>
                <b>{r.roomCode}</b> · {f('cp_hot_people', { n: r.complainants, c: r.count })}
                {r.substantiated > 0 && <span>{f('cp_hot_subst', { n: r.substantiated })}</span>}
                {r.singleSource && <span style={{ color: '#8c8c8c' }}>{t('cp_hot_single')}</span>}
              </Tag>
            ))}
          </Space>
        </Card>
      )}

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Radio.Group value={filters.open ?? ''} onChange={(e) => setF('open', e.target.value || undefined)}
            optionType="button" buttonStyle="solid" size="small"
            options={[{ label: t('cp_open'), value: 'true' }, { label: t('cp_all'), value: '' }]} />
          <Select allowClear style={{ width: 190 }} placeholder={t('cp_type')}
            onChange={(v) => setF('typeId', v)}
            options={(meta.complaintTypes ?? []).map((ct: any) => ({ value: ct.id, label: dn(ct) }))} />
          <Select allowClear style={{ width: 140 }} placeholder={t('cp_status')}
            onChange={(v) => { setPage(1); setFilters((x) => ({ ...x, status: v, open: v ? undefined : x.open })); }}
            options={(meta.complaintStatuses ?? []).map((s: string) => ({ value: s, label: L(s) }))} />
          <Select allowClear style={{ width: 130 }} placeholder={t('cp_anon_filter')}
            onChange={(v) => setF('anonymous', v)}
            options={[{ value: 'true', label: t('cp_anon') }, { value: 'false', label: t('cp_named') }]} />
          <Input.Search allowClear style={{ width: 200 }} placeholder={t('cp_search')}
            onSearch={(v) => setF('q', v || undefined)} />
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          size="small" rowKey="id" loading={loading} dataSource={rows}
          onRow={(r) => ({ onClick: () => openDetail(r.id), style: { cursor: 'pointer' } })}
          pagination={{ current: page, total, pageSize: 20, onChange: setPage, size: 'small', showTotal: (n) => f('cp_total', { n }) }}
          columns={[
            { title: t('cp_code'), dataIndex: 'code', width: 104 },
            {
              title: t('cp_type'), dataIndex: 'type', width: 175,
              render: (v: any, r: any) => (
                <Space size={4} wrap>
                  <span>{typeName(v)}</span>
                  {r.severity && <Tag color={SEVERITY_COLOR[r.severity]} style={{ marginInlineEnd: 0 }}>{labelOf(SEVERITY_LABEL, r.severity, lang)}</Tag>}
                  {r.routeTo !== 'WARDEN' && (
                    <Tooltip title={t('cp_route_tip')}>
                      <Tag color="purple" style={{ marginInlineEnd: 0 }}>{labelOf(COMPLAINT_ROUTE_LABEL, r.routeTo, lang)}</Tag>
                    </Tooltip>
                  )}
                </Space>
              ),
            },
            { title: t('cp_location'), dataIndex: 'location', width: 165, ellipsis: true },
            {
              title: t('cp_occurred'), dataIndex: 'occurredFrom', width: 140,
              render: (v: string, r: any) => (
                <Tooltip title={f('cp_submitted_at', { t: dayjs(r.submittedAt).format('MM-DD HH:mm') })}>
                  <span>{dayjs(v).format('MM-DD HH:mm')}</span>
                  {/* 噪音基本都发生在深夜，高亮一下，宿管一眼能看出该几点去蹲 */}
                  {(dayjs(v).hour() >= 22 || dayjs(v).hour() <= 5) && (
                    <Tag color="blue" style={{ marginLeft: 6 }}>{t('cp_late_night')}</Tag>
                  )}
                </Tooltip>
              ),
            },
            {
              title: t('cp_complainant'), dataIndex: 'complainant', width: 130,
              // 匿名投诉的姓名在列表里永远不出现，服务端就没返回。
              // 要看必须进详情点「查看身份」，那一下会写审计
              render: (v: any, r: any) =>
                r.anonymous
                  ? <Tag icon={<EyeInvisibleOutlined />} color="default">{t('cp_anon')}</Tag>
                  : <Space size={4}><UserOutlined style={{ color: '#8c8c8c' }} />{v?.name ?? '—'}</Space>,
            },
            {
              title: t('cp_content'), dataIndex: 'description', ellipsis: true,
              render: (v: string, r: any) => (
                <Space size={4}>
                  {/* 匿名且没写文字的，服务端不返回 lang —— 否则等于告诉宿管投诉人的国籍 */}
                  {r.lang && r.lang !== lang && <Tag style={{ marginInlineEnd: 0 }}>{r.lang.toUpperCase()}</Tag>}
                  {r.attachmentCount > 0 && <Tag icon={<PaperClipOutlined />} style={{ marginInlineEnd: 0 }}>{r.attachmentCount}</Tag>}
                  <span>{v}</span>
                </Space>
              ),
            },
            {
              title: t('cp_status'), dataIndex: 'status', width: 110,
              render: (v: string, r: any) => (
                <Space size={4} direction="vertical" style={{ lineHeight: 1.3 }}>
                  <Tag color={COMPLAINT_STATUS_COLOR[v]} style={{ marginInlineEnd: 0 }}>{L(v)}</Tag>
                  {['NEW', 'ACCEPTED', 'INVESTIGATING'].includes(v) && r.deadline &&
                    dayjs().isAfter(r.deadline) && <Tag color="red" style={{ marginInlineEnd: 0 }}>{t('cp_overdue')}</Tag>}
                </Space>
              ),
            },
            {
              title: t('cp_priority'), dataIndex: 'priority', width: 84,
              render: (v: string) => <Tag color={PRIORITY_COLOR[v]}>{labelOf(PRIORITY_LABEL, v, lang)}</Tag>,
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
            {detail.status === 'NEW' && <Button type="primary" onClick={() => doAccept(detail.id)}>{t('cp_accept')}</Button>}
            {detail.status === 'ACCEPTED' && <Button onClick={() => doInvestigate(detail.id)}>{t('cp_investigate')}</Button>}
            {['ACCEPTED', 'INVESTIGATING'].includes(detail.status) && (
              <Button type="primary" onClick={openResolve}>{t('cp_resolve')}</Button>
            )}
            {['SUBSTANTIATED', 'UNSUBSTANTIATED', 'DUPLICATE'].includes(detail.status) && (
              <Button onClick={doClose}>{t('cp_archive')}</Button>
            )}
          </Space>
        )}
      >
        {detail && (
          <>
            {detail.distinctComplainants >= 3 && (
              <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                message={f('cp_multi_title', { n: detail.distinctComplainants })}
                description={t('cp_multi_desc')} />
            )}
            {detail.related?.length > 0 && (
              <Card size="small" style={{ marginBottom: 12 }}
                title={f('cp_related', { n: detail.related.length })}
                extra={<span style={muted}>{t('cp_related_tip')}</span>}>
                <Table size="small" rowKey="id" pagination={false} dataSource={detail.related}
                  columns={[
                    { title: t('cp_code'), dataIndex: 'code', width: 150 },
                    { title: t('cp_occurred_short'), dataIndex: 'occurredFrom', width: 110, render: (v: string) => dayjs(v).format('MM-DD HH:mm') },
                    { title: t('cp_status'), dataIndex: 'status', width: 90, render: (v: string) => <Tag color={COMPLAINT_STATUS_COLOR[v]}>{L(v)}</Tag> },
                    { title: t('cp_content'), dataIndex: 'description', ellipsis: true },
                    ...(can('complaint:write') && ['NEW', 'ACCEPTED', 'INVESTIGATING'].includes(detail.status) ? [{
                      title: '', width: 110,
                      render: (_: any, r: any) => <Button size="small" onClick={() => doMerge(r)}>{t('cp_merge_here')}</Button>,
                    }] : []),
                  ]} />
              </Card>
            )}

            <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}
              items={[
                {
                  label: t('cp_type'),
                  children: <Space size={4}>{typeName(detail.type)}<Tag color={SEVERITY_COLOR[detail.severity]}>{labelOf(SEVERITY_LABEL, detail.severity, lang)}</Tag></Space>,
                },
                { label: t('cp_route'), children: labelOf(COMPLAINT_ROUTE_LABEL, detail.routeTo, lang) },
                { label: t('cp_location'), children: detail.location, span: 2 },
                {
                  label: t('cp_period'), span: 2,
                  children: (
                    <Space size={4}>
                      <b>{dayjs(detail.occurredFrom).format('YYYY-MM-DD HH:mm')}</b>
                      {detail.occurredTo && <span>— {dayjs(detail.occurredTo).format('HH:mm')}</span>}
                      <span style={muted}>{f('cp_submitted_paren', { t: dayjs(detail.submittedAt).format('MM-DD HH:mm') })}</span>
                    </Space>
                  ),
                },
                {
                  label: t('cp_complainant'), span: 2,
                  children: detail.anonymous ? (
                    <Space>
                      <Tag icon={<EyeInvisibleOutlined />}>{t('cp_anon_submitted')}</Tag>
                      {identity ? (
                        <Space size={4}>
                          <b>{identity.name}</b>
                          <span style={{ color: '#8c8c8c' }}>{identity.employeeNo} · {identity.roomCode ?? '—'}</span>
                        </Space>
                      ) : detail.canReveal ? (
                        <Button size="small" danger icon={<EyeInvisibleOutlined />} onClick={() => doReveal(detail.id)}>
                          {t('cp_reveal_btn')}
                        </Button>
                      ) : (
                        <span style={muted}>{t('cp_no_reveal')}</span>
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
                { label: t('cp_content'), span: 2, children: <span>{detail.description || '—'}</span> },
                ...(detail.resolution ? [{ label: t('cp_resolution'), span: 2, children: detail.resolution }] : []),
                ...(detail.rating ? [{ label: t('cp_rating'), span: 2, children: <Space><Rate disabled value={detail.rating} style={{ fontSize: 14 }} />{detail.ratingComment}</Space> }] : []),
              ]}
            />

            {identity && (
              <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                message={t('cp_viewing_identity')} description={identity.warning} />
            )}

            {detail.attachments?.length > 0 && (
              <Card size="small" title={<Space size={6}><PaperClipOutlined />{t('cp_evidence')}</Space>} style={{ marginBottom: 12 }}>
                <Space wrap>
                  {detail.attachments.map((a: any) => <AuthMedia key={a.id} att={a} />)}
                </Space>
              </Card>
            )}

            {detail.occupants?.length > 0 && (
              <Card size="small" title={t('cp_occupants')} style={{ marginBottom: 12 }}
                extra={<span style={muted}>{t('cp_occupants_tip')}</span>}>
                <Space wrap size={6}>
                  {detail.occupants.map((o: any) => (
                    <Tag key={o.personId}>{o.name} · {o.bedCode}{o.department ? ` · ${o.department}` : ''}</Tag>
                  ))}
                </Space>
              </Card>
            )}

            <Card size="small" title={t('cp_timeline')}>
              <Timeline
                items={(detail.events ?? []).map((e: any) => ({
                  color: e.type === 'RESOLVE' ? 'green' : e.type === 'REVEAL_IDENTITY' ? 'red' : 'blue',
                  children: (
                    <div style={{ fontSize: 13 }}>
                      <Space size={6}>
                        <b>{t(`cp_ev_${e.type}`)}</b>
                        <span style={muted}>{e.operator}</span>
                        <span style={{ color: '#bfbfbf', fontSize: 12 }}>{dayjs(e.createdAt).format('MM-DD HH:mm')}</span>
                        {!e.visibleToComplainant && <Tag style={{ fontSize: 11 }}>{t('cp_internal')}</Tag>}
                      </Space>
                      {e.note && <div style={{ color: '#595959' }}>{e.note}</div>}
                    </div>
                  ),
                }))}
              />
              {(detail.events ?? []).length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              {can('complaint:write') && (
                <Space.Compact style={{ width: '100%', marginTop: 8 }}>
                  <Input placeholder={t('cp_comment_ph')} value={comment} onChange={(e) => setComment(e.target.value)}
                    onPressEnter={doComment} maxLength={1000} />
                  <Select value={commentPublic} onChange={setCommentPublic} style={{ width: 150 }}
                    options={[{ value: false, label: t('cp_internal_only') }, { value: true, label: t('cp_visible') }]} />
                  <Button type="primary" onClick={doComment} disabled={!comment.trim()}>{t('cp_add')}</Button>
                </Space.Compact>
              )}
            </Card>
          </>
        )}
      </Drawer>

      {/* ============================== 认定弹窗 ============================== */}
      <Modal
        open={resolveOpen} title={t('cp_resolve')} onCancel={() => setResolveOpen(false)}
        onOk={submitResolve} okText={t('cp_submit_decision')} width={560}
      >
        <Form form={form} layout="vertical" initialValues={{ outcome: 'SUBSTANTIATED' }}>
          <Form.Item name="outcome" label={t('cp_outcome')} rules={[{ required: true }]}>
            <Radio.Group optionType="button" buttonStyle="solid"
              options={[
                { label: t('cp_substantiated'), value: 'SUBSTANTIATED' },
                { label: t('cp_unsubstantiated'), value: 'UNSUBSTANTIATED' },
                { label: t('cp_duplicate'), value: 'DUPLICATE' },
              ]} />
          </Form.Item>

          <Form.Item name="resolution" label={t('cp_resolution_label')} extra={t('cp_resolution_extra')}
            rules={[{ required: true, whitespace: true, message: t('cp_resolution_required') }]}>
            <Input.TextArea rows={3} placeholder={t('cp_resolution_ph')} />
          </Form.Item>

          {outcome === 'SUBSTANTIATED' && (
            <>
              <Alert type="warning" showIcon style={{ marginBottom: 12 }}
                message={t('cp_vio_warn')} description={t('cp_vio_warn_desc')} />
              <Form.Item name="violationTypeId" label={t('cp_vio_type')} extra={t('cp_vio_type_extra')}>
                <Select allowClear placeholder={t('cp_vio_type_ph')}
                  options={meta.violationTypes.map((v: any) => ({
                    value: v.id,
                    label: f('cp_vio_label', {
                      name: dn(v), p: v.defaultPoints,
                      fine: v.defaultFine > 0 ? f('cp_vio_fine', { f: v.defaultFine }) : '',
                    }),
                  }))} />
              </Form.Item>
              <Form.Item name="violationPersonIds" label={t('cp_responsible')} extra={t('cp_responsible_extra')}>
                <Select mode="multiple" allowClear placeholder={t('cp_responsible_ph')}
                  options={(detail?.occupants ?? []).map((o: any) => ({
                    value: o.personId, label: `${o.name} (${o.employeeNo} · ${o.bedCode})`,
                  }))} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}

/**
 * 投诉照片 / 录音。附件接口要鉴权，<img src> / <audio src> 直接请求不带 token 会 401，
 * 所以先带 token 取成 Blob 再给元素用。
 */
function AuthMedia({ att }: { att: any }) {
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    fetchBlob(att.url.replace(/^\/api/, ''))
      .then((b) => { url = URL.createObjectURL(b); setSrc(url); })
      .catch(() => setErr(true));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [att.url]);
  if (err) return <Tag color="red">{t('cp_att_fail')}</Tag>;
  if (att.kind === 'PHOTO') {
    return src
      ? <Image src={src} width={110} height={110} style={{ objectFit: 'cover', borderRadius: 4 }} />
      : <div style={{ width: 110, height: 110, background: '#f5f5f5', borderRadius: 4 }} />;
  }
  return (
    <Space direction="vertical" size={2}>
      <Space size={4} style={{ fontSize: 12, color: '#8c8c8c' }}><SoundOutlined />{t('cp_audio')}</Space>
      {src ? <audio controls src={src} style={{ height: 32 }} /> : <span style={{ fontSize: 12 }}>{t('cp_loading')}</span>}
    </Space>
  );
}
