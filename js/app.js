// 河北元赫汽车服务有限公司 - 全域数字化系统 v3.0 (消费者官网 index.html + 商家后台 merchant.html 双端同步引擎)
const { createApp, ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

const STORAGE_KEY = "yuanhe_digital_system_v3_1";
const syncChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("yuanhe_sync_v3_1") : null;

createApp({
  setup() {
    // 1. 初始化加载数据（优先本地缓存/服务端同步，保证版本v3.1结构完整）
    const loadInitialState = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.version === "3.1" && Array.isArray(parsed.vehicles)) {
            return parsed;
          }
        }
      } catch (e) {}
      return JSON.parse(JSON.stringify(window.YUANHE_DEFAULT_DATA));
    };

    const state = reactive(loadInitialState());
    let isRemoteUpdating = false;
    const CLOUD_BIN_URL = "https://api.jsonbin.io/v3/b/6af13c93ffd5d16053b24f53";
    const CLOUD_API_KEY = "$2a$10$fBRm/eLFlP3Nu/PrYTSBf.PzNeup/avMD/XpgeDlMMECIsciQUr5i";
    let cloudSyncDebounce = null;

    // 同步保存至本地后端 yuanhe_data.json + 24小时云端数据库 JSONBin + localStorage
    const persistAndSync = (val) => {
      if (isRemoteUpdating) return;
      const jsonStr = JSON.stringify(val);
      try {
        localStorage.setItem(STORAGE_KEY, jsonStr);
      } catch (e) {}
      if (syncChannel) {
        try {
          syncChannel.postMessage(jsonStr);
        } catch (e) {}
      }
      fetch("./api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: jsonStr
      }).catch(() => {});

      if (cloudSyncDebounce) clearTimeout(cloudSyncDebounce);
      cloudSyncDebounce = setTimeout(() => {
        const cloudPayload = {
          updatedAt: Date.now(),
          leads: val.leads || [],
          chatMessages: val.chatMessages || [],
          company: val.company,
          chargingStations: val.chargingStations,
          articles: val.articles
        };
        fetch(CLOUD_BIN_URL, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Master-Key": CLOUD_API_KEY
          },
          body: JSON.stringify(cloudPayload)
        }).catch(() => {});
      }, 350);
    };

    watch(
      () => state,
      (val) => {
        persistAndSync(val);
      },
      { deep: true }
    );

    // 消费者端视图切换：website (官方网站) | miniprogram (微信小程序预览) | wechat_oa (微信公众号预览)
    const activePlatform = ref("website");

    // 商家后台导航：fleet_mgr (车型库) | brand_mgr (官网管理) | mp_mgr (小程序管理) | oa_mgr (公众号管理) | leads_mgr (线索与坐席)
    const merchantTab = ref("fleet_mgr");
    const leadChannelFilter = ref("all"); // all | web | mp | oa

    const mpLeadsList = computed(() => {
      return (state.leads || []).filter((l) => l.source && l.source.includes("小程序"));
    });

    const webLeadsList = computed(() => {
      return (state.leads || []).filter((l) => !l.source || !l.source.includes("小程序"));
    });

    const filteredMerchantLeads = computed(() => {
      const list = state.leads || [];
      if (leadChannelFilter.value === "mp") return mpLeadsList.value;
      if (leadChannelFilter.value === "web") return webLeadsList.value;
      return list;
    });

    const filteredChatMessages = computed(() => {
      const list = state.chatMessages || [];
      if (leadChannelFilter.value === "mp") {
        return list.filter((m) => m.channel && m.channel.includes("小程序"));
      }
      if (leadChannelFilter.value === "oa") {
        return list.filter((m) => m.channel && m.channel.includes("公众号"));
      }
      if (leadChannelFilter.value === "web") {
        return list.filter((m) => !m.channel || m.channel.includes("官网"));
      }
      return list;
    });

    // 消费者官网 5 大独立页面：home | fleet | calc | services | trust
    const webNavItems = [
      { id: "home", label: "🏠 品牌首页", shortLabel: "🏠 首页" },
      { id: "fleet", label: "🚗 3D车型展厅", shortLabel: "🚗 3D展厅" },
      { id: "calc", label: "🧮 跑车收益测算", shortLabel: "🧮 算收益" },
      { id: "services", label: "🌐 四大核心业务", shortLabel: "🌐 业务" },
      { id: "trust", label: "🛡️ 合规资质与实力", shortLabel: "🛡️ 资质" }
    ];
    const webPage = ref("home");

    const activeNavIndex = computed(() => {
      const idx = webNavItems.findIndex((item) => item.id === webPage.value);
      return idx >= 0 ? idx : 0;
    });

    // 切换独立页面时，让中间滚动容器回到顶部
    const switchWebPage = (pageId, scrollTargetId = null) => {
      if (pageId === "booking") {
        openBookingModal("品牌首页·购车与租车咨询", state.vehicles[0]?.name || "比亚迪 秦PLUS EV", "官网品牌首页");
        return;
      }
      webPage.value = pageId;
      nextTick(() => {
        const mainEl = document.getElementById("main-scroll-container");
        if (scrollTargetId) {
          const target = document.getElementById(scrollTargetId);
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
        }
        if (mainEl) mainEl.scrollTo({ top: 0, behavior: "smooth" });
      });
    };

    // 全局轻提示 Toast
    const toast = reactive({ show: false, msg: "", type: "success" });
    let toastTimer = null;
    const showToast = (msg, type = "success") => {
      toast.msg = msg;
      toast.type = type;
      toast.show = true;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.show = false;
      }, 3200);
    };

    // ==========================================
    // 车型展厅、热门款排序与 3D 展台逻辑
    // ==========================================
    const webCarFilter = ref("all");

    const sortedVehicles = computed(() => {
      return [...state.vehicles].sort((a, b) => (b.isHot ? 1 : 0) - (a.isHot ? 1 : 0));
    });

    const filteredWebVehicles = computed(() => {
      const list = sortedVehicles.value;
      if (webCarFilter.value === "all") return list;
      if (webCarFilter.value === "hot") return list.filter((v) => v.isHot);
      return list.filter((v) => v.category === webCarFilter.value);
    });

    const hotVehicles = computed(() => {
      const hots = state.vehicles.filter((v) => v.isHot);
      return hots.length ? hots : [state.vehicles[0]];
    });

    const toggleHotCar = (car) => {
      car.isHot = !car.isHot;
      showToast(
        car.isHot
          ? `🔥 已将【${car.name}】设为热门爆款！消费者官网已实时高亮置顶`
          : `已取消【${car.name}】的热门款状态`
      );
    };

    // 卡片四维视角切换：front | side | rear | interior
    const cardViewAngles = reactive({});
    const getCardAngle = (carId) => cardViewAngles[carId] || "front";
    const setCardAngle = (carId, angle) => {
      cardViewAngles[carId] = angle;
    };

    // 3D车型展厅顶部的 360° 全景交互看车展台
    const stage3d = reactive({
      selectedCarId: "v_qin_plus_ev",
      currentAngle: "front",
      rotationDeg: 0,
      autoRotate: false,
      isDragging: false,
      startX: 0
    });

    const stageCar = computed(() => {
      return state.vehicles.find((v) => v.id === stage3d.selectedCarId) || sortedVehicles.value[0];
    });

    const selectStageCar = (car) => {
      stage3d.selectedCarId = car.id;
      stage3d.currentAngle = "front";
      stage3d.rotationDeg = 0;
      nextTick(() => {
        const el = document.getElementById("fleet-3d-stage");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };

    const onStageMouseDown = (e) => {
      stage3d.isDragging = true;
      stage3d.startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    };

    const onStageMouseMove = (e) => {
      if (!stage3d.isDragging) return;
      const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      const delta = clientX - stage3d.startX;
      stage3d.rotationDeg = Math.max(-30, Math.min(30, stage3d.rotationDeg + delta * 0.3));
      stage3d.startX = clientX;
      if (delta > 18 && stage3d.currentAngle === "front") stage3d.currentAngle = "side";
      else if (delta > 18 && stage3d.currentAngle === "side") stage3d.currentAngle = "rear";
      else if (delta < -18 && stage3d.currentAngle === "rear") stage3d.currentAngle = "side";
      else if (delta < -18 && stage3d.currentAngle === "side") stage3d.currentAngle = "front";
    };

    const onStageMouseUp = () => {
      stage3d.isDragging = false;
      stage3d.rotationDeg = 0;
    };

    let autoRotateTimer = null;
    watch(
      () => stage3d.autoRotate,
      (val) => {
        if (autoRotateTimer) clearInterval(autoRotateTimer);
        if (val) {
          const order = ["front", "side", "rear", "interior"];
          autoRotateTimer = setInterval(() => {
            const idx = order.indexOf(stage3d.currentAngle);
            stage3d.currentAngle = order[(idx + 1) % order.length];
          }, 2200);
        }
      }
    );

    // ==========================================
    // 3D车型展厅底部：消费者自由选择任意两款车 PK 对比器 (Requirement 6)
    // ==========================================
    const compareIds = reactive({
      left: "v_qin_plus_ev",
      right: "v_aion_s_plus"
    });
    const compareLeftAngle = ref("front");
    const compareRightAngle = ref("front");

    const compareLeftCar = computed(() => state.vehicles.find((v) => v.id === compareIds.left) || state.vehicles[0]);
    const compareRightCar = computed(() => state.vehicles.find((v) => v.id === compareIds.right) || state.vehicles[1] || state.vehicles[0]);

    const setAsCompare = (slot, car) => {
      compareIds[slot] = car.id;
      showToast(`⚖️ 已将【${car.name}】放入对比栏 ${slot === "left" ? "A(左)" : "B(右)"}！`);
      nextTick(() => {
        const pkEl = document.getElementById("fleet-pk-section");
        if (pkEl) pkEl.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };

    // ==========================================
    // 跑车收益测算页 + 石家庄高流水派单热力沙盘 (Requirement 7)
    // ==========================================
    const calc = reactive({
      selectedCarId: "v_qin_plus_ev",
      coopMode: "rent",
      hoursPerDay: 10.5,
      daysPerMonth: 26,
      chargeType: "valley"
    });

    const calcResult = computed(() => {
      const car = state.vehicles.find((v) => v.id === calc.selectedCarId) || state.vehicles[0];
      const hourlyGross = car && car.id.includes("aion") ? 41 : 39;
      const dailyKm = Math.round(calc.hoursPerDay * 27);
      const dailyGross = Math.round(calc.hoursPerDay * hourlyGross);
      const monthlyBonus = calc.daysPerMonth >= 26 && calc.hoursPerDay >= 10 ? 550 : 200;
      const monthlyGross = dailyGross * calc.daysPerMonth + monthlyBonus;

      const kmCost = calc.chargeType === "valley" ? 0.075 : 0.12;
      const monthlyElecCost = Math.round(dailyKm * calc.daysPerMonth * kmCost);

      const monthlyVehicleCost =
        calc.coopMode === "rent"
          ? car ? Number(car.rentMonthly) : 3200
          : car ? Number(car.leaseMonthly) : 3580;

      const monthlyNet = Math.max(0, monthlyGross - monthlyElecCost - monthlyVehicleCost);
      const dailyNet = Math.round(monthlyNet / calc.daysPerMonth);
      const yearlyNet = monthlyNet * 12;

      return {
        carName: car ? car.name : "比亚迪 秦PLUS EV",
        dailyKm,
        dailyGross,
        monthlyBonus,
        monthlyGross,
        monthlyElecCost,
        monthlyVehicleCost,
        monthlyNet,
        dailyNet,
        yearlyNet
      };
    });

    const sjzHotspots = [
      {
        name: "🚄 石家庄火车站（西广场/东广场）",
        peakTime: "全天高频 · 夜间21:00-24:00大单密集",
        avgOrder: "¥28 ~ ¥65/单",
        tip: "元赫火车站补能站距西广场仅1.2km，午间谷电快充30分钟即可满血继续接高铁大单。",
        level: "极高热力 🔥🔥🔥"
      },
      {
        name: "✈️ 正定国际机场 & 正定古城景区",
        peakTime: "06:30-10:00 / 16:00-22:00",
        avgOrder: "¥68 ~ ¥120/单",
        tip: "广汽埃安AION S/Y超大后排与大后备箱极受机场旅客欢迎，聚合平台高分号优先派发跨区长途单。",
        level: "高客单价 💎💎💎"
      },
      {
        name: "🏬 长安区北国商城 / 勒泰 / 万达商圈",
        peakTime: "早晚通勤高峰 + 周末全天",
        avgOrder: "¥18 ~ ¥38/单",
        tip: "毗邻长安区高营大街元赫总部，订单连环派发空驶率极低，适合比亚迪秦PLUS EV高频冲单拿平台奖励。",
        level: "高频连单 ⚡⚡⚡"
      },
      {
        name: "🎓 裕华区大学城 & 高新区科技园",
        peakTime: "周五下午 / 周日返校 / 早晚通勤",
        avgOrder: "¥22 ~ ¥45/单",
        tip: "年轻乘客多、素质高、好评率高，极易快速提升账号服务分。",
        level: "优质口碑 ⭐⭐⭐"
      }
    ];
    const activeHotspotIdx = ref(0);

    // ==========================================
    // 右侧常驻【在线咨询、电话、微信】悬浮客服系统（与商家后台双向实时互通）
    // ==========================================
    if (!Array.isArray(state.chatMessages) || state.chatMessages.length === 0) {
      state.chatMessages = JSON.parse(JSON.stringify(window.YUANHE_DEFAULT_DATA.chatMessages || []));
    }

    const nowTimeStr = () => {
      const d = new Date();
      return d.toLocaleTimeString("zh-CN", { hour12: false });
    };

    const consultWidget = reactive({
      chatOpen: false,
      activePopup: null,
      inputMsg: ""
    });

    const merchantReplyInput = ref("");

    const sendConsultMsg = (presetText = null) => {
      const txt = (presetText || consultWidget.inputMsg).trim();
      if (!txt) return;
      consultWidget.chatOpen = true;
      state.chatMessages.push({
        id: Date.now(),
        from: "user",
        senderName: "官网访客/司机",
        time: nowTimeStr(),
        text: txt
      });
      if (!presetText) consultWidget.inputMsg = "";

      // 若客户在聊天中直接发送了11位手机号，自动提取并归档进商家线索池
      const phoneMatch = txt.match(/1[3-9]\d{9}/);
      if (phoneMatch) {
        state.leads.unshift({
          id: "lead_" + Date.now(),
          name: "在线咨询访客",
          phone: phoneMatch[0],
          type: "在线客服聊天留电",
          targetCar: stageCar.value ? stageCar.value.name : "待定",
          note: `聊天原话：${txt}`,
          source: "消费者官网·在线客服窗",
          time: `今天 ${nowTimeStr()}`,
          status: "新提交·待联系"
        });
      }

      setTimeout(() => {
        let reply = `收到您的咨询（已实时同步至元赫后台人工坐席）！我们的总部位于【${state.company.address}】，现车充足。您可直接拨打 ${state.company.phone} 或添加微信 ${state.company.wechatId}，也可直接在下方留下您的手机号，杨经理会立即在窗口或电话回复您！`;
        if (txt.includes("秦") || txt.includes("价格") || txt.includes("租金")) {
          reply = "🔥 热门款【比亚迪 秦PLUS EV】合规纯租 ¥3,200/月起，【广汽埃安 AION S Plus】¥3,300/月起，【一汽红旗 E-QM5】¥3,500/月起（均含100万三者险、50万/座座位险与免费定期保养）！";
        } else if (txt.includes("证") || txt.includes("新手") || txt.includes("合同")) {
          reply = "✅ 签正规《车辆租赁协议》：每月含10,000公里额度，石家庄市区24小时免费救援，非司机原因维修超期次日起免费提供替代车或免租，期满无违章15个工作日无息退押金！";
        }
        state.chatMessages.push({
          id: Date.now() + 1,
          from: "agent",
          senderName: "元赫智能顾问",
          time: nowTimeStr(),
          text: reply
        });
      }, 350);
    };

    // 商家在后台直接人工回复消费者在线咨询
    const sendMerchantReply = (quickText = null) => {
      const txt = (quickText || merchantReplyInput.value).trim();
      if (!txt) {
        showToast("请输入要回复给客户的内容", "warn");
        return;
      }
      state.chatMessages.push({
        id: Date.now(),
        from: "merchant",
        senderName: "👨‍💼 元赫人工客服（杨经理）",
        time: nowTimeStr(),
        text: txt
      });
      if (!quickText) merchantReplyInput.value = "";
      persistAndSync(state);
      showToast("✅ 已发送人工回复！消费者官网聊天窗口已实时收到");
    };

    const clearChatHistory = () => {
      state.chatMessages = JSON.parse(JSON.stringify(window.YUANHE_DEFAULT_DATA.chatMessages || []));
      persistAndSync(state);
      showToast("已重置在线咨询对话记录");
    };

    const copyText = (str, label = "内容") => {
      if (navigator.clipboard) navigator.clipboard.writeText(str);
      showToast(`✅ 已复制${label}：${str}`);
    };

    // 弹窗控制
    const activeCarModal = ref(null);
    const modalAngle = ref("front");
    const openCarDetail = (car, defaultAngle = "front") => {
      activeCarModal.value = car;
      modalAngle.value = defaultAngle;
    };

    const bookingModal = reactive({
      open: false,
      name: "",
      phone: "",
      type: "网约车司机加盟（合规纯租）",
      targetCar: "比亚迪 秦PLUS EV 冠军/荣耀版",
      note: "",
      source: "消费者官网"
    });

    const openBookingModal = (defaultType = "网约车司机加盟（合规纯租）", carName = "", source = "消费者官网") => {
      bookingModal.type = defaultType;
      bookingModal.targetCar = carName || (state.vehicles[0] ? state.vehicles[0].name : "比亚迪 秦PLUS EV");
      bookingModal.source = source;
      bookingModal.open = true;
    };

    const submitBooking = () => {
      if (!bookingModal.name.trim() || !bookingModal.phone.trim()) {
        showToast("请填写您的称呼与联系电话，方便专属顾问为您安排看车！", "warn");
        return;
      }
      state.leads.unshift({
        id: "lead_" + Date.now(),
        name: bookingModal.name.trim(),
        phone: bookingModal.phone.trim(),
        type: bookingModal.type,
        targetCar: bookingModal.targetCar,
        note: bookingModal.note.trim() || "预约前往长安区高营大街30号总部现场看车试驾",
        source: bookingModal.source,
        time: `今天 ${nowTimeStr()}`,
        status: "新提交·待联系"
      });
      persistAndSync(state);
      bookingModal.open = false;
      bookingModal.name = "";
      bookingModal.phone = "";
      bookingModal.note = "";
      activeCarModal.value = null;
      showToast("🎉 预约提交成功！您的资料已实时传送至商家管理后台，杨经理将尽快联系您！");
    };

    // 商家后台一键导出客户线索为 Excel CSV
    const exportLeadsCsv = () => {
      const headers = ["客户称呼", "联系电话", "业务意向类型", "意向车型", "客户留言与需求", "来源渠道", "提交时间", "跟进状态"];
      const rows = state.leads.map((l) => [
        l.name,
        l.phone,
        l.type,
        l.targetCar,
        (l.note || "").replace(/,/g, "，"),
        l.source,
        l.time,
        l.status
      ]);
      const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `河北元赫汽车_客户预约与咨询线索表_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("📥 已导出 Excel (CSV) 客户线索名单！");
    };

    // ==========================================
    // 小程序与公众号全功能高保真交互逻辑
    // ==========================================
    const mpMode = ref("driver"); // driver (网约车司机端) | personal (个人自驾/政企租售端)
    const mpTab = ref("home"); // home | cars | service | chat | mine
    const mpCarFilter = ref("all");
    const mpRentPaid = ref(false);
    const mpCurrentKm = ref(6820);
    const mpContractOpen = ref(false);
    const mpActiveCar = ref(null);
    const mpActiveCarAngle = ref("front");

    const openMpCarDetail = (car) => {
      mpActiveCar.value = car;
      mpActiveCarAngle.value = "front";
    };

    const mpFilteredCars = computed(() => {
      const list = sortedVehicles.value;
      if (mpCarFilter.value === "all") return list;
      if (mpCarFilter.value === "hot") return list.filter((v) => v.isHot);
      return list.filter((v) => v.category === mpCarFilter.value);
    });

    const mpJoinForm = reactive({
      name: "",
      phone: "",
      driveYears: "3年以上",
      hasCert: "暂无网约车人证（需元赫协办）",
      targetCar: "比亚迪 秦PLUS EV / 秦EV 营运版",
      mode: "合规纯租（含100万三者险+保养）"
    });

    const mpMaintForm = reactive({
      driverName: "",
      phone: "",
      plateNo: "冀A·D",
      carModel: "比亚迪秦EV（首保5000km / 常规每20000km）",
      currentKm: "",
      date: "明天上午 09:30"
    });

    const submitMpMaintenance = () => {
      if (!mpMaintForm.driverName.trim() || !mpMaintForm.phone.trim()) {
        showToast("请填写司机姓名与联系电话以便安排免费定保工位", "warn");
        return;
      }
      state.leads.unshift({
        id: "lead_" + Date.now(),
        name: mpMaintForm.driverName.trim(),
        phone: mpMaintForm.phone.trim(),
        type: `🔧 小程序免费定期保养预约 (${mpMaintForm.plateNo})`,
        targetCar: mpMaintForm.carModel,
        note: `当前表显里程：${mpMaintForm.currentKm || "未填"} km | 预约时段：${mpMaintForm.date}`,
        source: "微信小程序·维保中心",
        time: `今天 ${nowTimeStr()}`,
        status: "新提交·待联系",
        merchantReply: "",
        replyDraft: ""
      });
      persistAndSync(state);
      mpMaintForm.driverName = "";
      mpMaintForm.phone = "";
      mpMaintForm.currentKm = "";
      showToast("🔧 免费定期保养预约已提交！已同步至商家后台线索池");
    };

    const mpChatInput = ref("");

    const submitMpJoin = () => {
      if (!mpJoinForm.name.trim() || !mpJoinForm.phone.trim()) {
        showToast("请在小程序内填写姓名和手机号", "warn");
        return;
      }
      state.leads.unshift({
        id: "lead_" + Date.now(),
        name: mpJoinForm.name.trim(),
        phone: mpJoinForm.phone.trim(),
        type: `小程序司机报名 (${mpJoinForm.mode})`,
        targetCar: mpJoinForm.targetCar,
        note: `驾龄：${mpJoinForm.driveYears} | 资质：${mpJoinForm.hasCert}`,
        source: "微信小程序",
        time: `今天 ${nowTimeStr()}`,
        status: "新提交·待联系",
        merchantReply: "",
        replyDraft: ""
      });
      // 同时在全渠道聊天坐席中同步生成一条小程序报名提醒
      state.chatMessages.push({
        id: Date.now(),
        from: "user",
        channel: "微信小程序",
        senderName: `📱 小程序用户（${mpJoinForm.name.trim()}）`,
        time: nowTimeStr(),
        text: `【小程序报名提交】我是${mpJoinForm.name.trim()}（电话：${mpJoinForm.phone.trim()}），意向车型：${mpJoinForm.targetCar}（${mpJoinForm.mode}），请问什么时候可以去高营大街总部看车？`
      });
      persistAndSync(state);
      mpJoinForm.name = "";
      mpJoinForm.phone = "";
      showToast("🎉 小程序报名成功！已实时同步至商家网页后台，可在下方查看商家回复！");
    };

    // 小程序内直接发送在线客服消息 -> 实时传到商家网页后台
    const sendMpConsultMsg = (presetText = null) => {
      const txt = (presetText || mpChatInput.value).trim();
      if (!txt) return;
      state.chatMessages.push({
        id: Date.now(),
        from: "user",
        channel: "微信小程序",
        senderName: "📱 微信小程序访客",
        time: nowTimeStr(),
        text: txt
      });
      if (!presetText) mpChatInput.value = "";
      persistAndSync(state);
    };

    // 商家在网页后台针对某条客户线索直接回复（同步到小程序报名进度回执与客服消息中心）
    const replyToLead = (ld, quickMsg = null) => {
      const txt = (
        quickMsg ||
        ld.replyDraft ||
        `【河北元赫汽车通知】${ld.name}您好！您的【${ld.targetCar}】预约申请已审核通过，请携带身份证与驾驶证前往石家庄市长安区高营大街30号御景半岛花园2号楼1824看车试驾，杨经理电话：17503114319`
      ).trim();
      ld.merchantReply = `${nowTimeStr()} 已回复：${txt}`;
      ld.status = "已邀约到店";
      ld.replyDraft = "";
      state.chatMessages.push({
        id: Date.now(),
        from: "merchant",
        channel: ld.source || "微信小程序",
        senderName: "👨‍💼 元赫网页后台人工回复（杨经理）",
        time: nowTimeStr(),
        text: `@${ld.name}（${ld.phone}）：${txt}`
      });
      persistAndSync(state);
      showToast(`✅ 已在网页端成功回复【${ld.name}】！小程序端与官网已实时收到通知！`);
    };

    const simulatePayRent = () => {
      mpRentPaid.value = true;
      showToast("✅ 模拟微信支付成功！本月租金 ¥3,200 已结清，电子收据已生成。");
    };

    // 微信公众号状态与多类型消息流
    const oaSubMenu = ref(null); // null | 'menu1' | 'menu2' | 'menu3'
    const oaInputMode = ref(false);
    const oaUserInput = ref("");
    const activeArticle = ref(null);

    const scrollOaBottom = () => {
      nextTick(() => {
        const el = document.getElementById("oa-scroll-box");
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      });
    };

    const oaMessages = ref([
      {
        id: 1,
        sender: "oa",
        type: "welcome",
        time: "09:30",
        title: "👋 欢迎关注【河北元赫汽车服务】官方服务号！",
        content:
          "深耕石家庄9年 · 5800万注册资本（统一社会信用代码：91130102MA08WQXD6B）· 持有《网络预约出租汽车经营许可证》合规持牌车企。\n\n🔥 四大核心服务：\n① 网约车合规纯租/以租代购（比亚迪秦EV / 广汽埃安 / 红旗E-QM5 现车直提）\n② 100万三者险 + 50万/座座位险 + 正常保养年审全包\n③ 石家庄市区24h免费救援 + 维修超期免费替代车\n④ 政企公务长租 & 新能源整车直售",
        links: [
          { label: "🚗 点击进入小程序：查看秦PLUS / 埃安 / 红旗现车底价", action: "goto_mp_cars" },
          { label: "📝 点击在线报名：预约长安区高营大街总部试驾", action: "goto_mp_mine" },
          { label: "📜 查阅《车辆租赁协议》6大阳光条款与定保规范", action: "push_contract" }
        ]
      },
      {
        id: 2,
        sender: "oa",
        type: "news_card",
        time: "09:31"
      }
    ]);

    const triggerFollowWelcome = () => {
      oaMessages.value.push({
        id: Date.now(),
        sender: "oa",
        type: "welcome",
        time: nowTimeStr(),
        title: "🎉 感谢关注【河北元赫汽车服务】！新司机/租客专属礼包已送达：",
        content:
          "🎁 福利1：网约车合规长租首月立减 ¥300 签约抵扣券\n🎁 福利2：元赫长安区高营大街超充站谷电专属折扣卡（¥0.45/度起）\n🎁 福利3：新手免费协办石家庄《网络预约出租汽车驾驶员证》",
        links: [
          { label: "👉 立即打开【元赫微信小程序】领取并选车", action: "goto_mp_home" },
          { label: "🏛️ 查看5800万注册资本《营业执照》原件", action: "push_license" }
        ]
      });
      scrollOaBottom();
      showToast("已触发公众号【新粉丝关注自动欢迎语】！");
    };

    const pushTemplateMsg = (tplType) => {
      if (tplType === "rent") {
        oaMessages.value.push({
          id: Date.now(),
          sender: "oa",
          type: "template",
          time: nowTimeStr(),
          tplTitle: "💳 车辆月租金账单到期温馨提醒",
          tplColor: "text-blue-600",
          fields: [
            { k: "承租司机", v: "王师傅 (冀A·D88692)" },
            { k: "承租车型", v: "比亚迪 秦PLUS EV 冠军版" },
            { k: "本月已跑里程", v: "6,820 km（合同免费额度 10,000 km/月）" },
            { k: "本期应缴租金", v: "¥ 3,200.00 元（含100万三者险与保养）" }
          ],
          actionText: "前往小程序【我的工作台】一键交租",
          actionCode: "goto_mp_mine"
        });
      } else if (tplType === "maint") {
        oaMessages.value.push({
          id: Date.now(),
          sender: "oa",
          type: "template",
          time: nowTimeStr(),
          tplTitle: "🔧 新能源汽车免费定期保养提醒",
          tplColor: "text-emerald-600",
          fields: [
            { k: "车牌与车型", v: "冀A·D88692 (比亚迪秦EV / 红旗E-QM5)" },
            { k: "合同定保标准", v: "秦EV每20000km或1年 / 红旗每20000km免费保养" },
            { k: "费用承担方", v: "河北元赫汽车全额承担（正常保养0费用）" },
            { k: "维保超期保障", v: "非司机原因无法用车，次日起免费提供替代车" }
          ],
          actionText: "前往小程序一键预约免费定保工位",
          actionCode: "goto_mp_service"
        });
      } else {
        oaMessages.value.push({
          id: Date.now(),
          sender: "oa",
          type: "template",
          time: nowTimeStr(),
          tplTitle: "🚗 预约到店看车试驾确认通知",
          tplColor: "text-teal-600",
          fields: [
            { k: "预约项目", v: "比亚迪秦PLUS EV / 埃安 / 红旗 现车试驾" },
            { k: "接待地址", v: state.company.address },
            { k: "接待负责人", v: `${state.company.legalRep}经理 (${state.company.phone})` }
          ],
          actionText: "打开小程序查看现车与导航",
          actionCode: "goto_mp_cars"
        });
      }
      scrollOaBottom();
      showToast("已向公众号会话推送微信【服务通知模板消息】！");
    };

    const handleOaAction = (code) => {
      oaSubMenu.value = null;
      const gotoMpTab = (targetTab) => {
        if (window.location.pathname.includes("miniprogram")) {
          mpTab.value = targetTab;
        } else {
          window.location.href = `./miniprogram.html?tab=${targetTab}`;
        }
      };
      if (code === "goto_mp_home") {
        gotoMpTab("home");
      } else if (code === "goto_mp_cars") {
        gotoMpTab("cars");
      } else if (code === "goto_mp_service") {
        gotoMpTab("service");
      } else if (code === "goto_mp_chat") {
        gotoMpTab("chat");
      } else if (code === "goto_mp_join" || code === "goto_mp_mine") {
        gotoMpTab("mine");
      } else if (code === "goto_web_calc") {
        window.location.href = "./index.html?page=calc";
      } else if (code === "read_art_1") {
        activeArticle.value = state.articles[0];
      } else if (code === "read_art_2") {
        activeArticle.value = state.articles[1] || state.articles[0];
      } else if (code === "read_art_3") {
        activeArticle.value = state.articles[2] || state.articles[0];
      } else if (code === "push_news") {
        oaMessages.value.push({
          id: Date.now(),
          sender: "oa",
          type: "news_card",
          time: nowTimeStr()
        });
        scrollOaBottom();
      } else if (code === "push_contract") {
        oaMessages.value.push({
          id: Date.now(),
          sender: "oa",
          type: "welcome",
          time: nowTimeStr(),
          title: "📜《河北元赫汽车·车辆租赁协议》六大阳光保障：",
          content:
            "1️⃣ 高额营运险全包：交强险、车损险、不计免赔、100万三者险、50万/座座位险全部由元赫承担；\n2️⃣ 正常保养年审全包：秦EV(5000/20000km)、红旗(20000km)、荣威MAX(3000/10000km)免费定保；\n3️⃣ 24h免费救援：石家庄市区内故障/事故24小时免费救援（17503114319）；\n4️⃣ 替代车兜底：年检/保养等非司机原因无法用车，次日起免费提供同等级替代车或免除期间租金；\n5️⃣ 充足里程：月限10,000公里/月（超里程仅0.3元/km）；\n6️⃣ 押金无忧退：期满收回车辆15个工作日内无违章一次性无息退还押金！",
          links: [{ label: "👉 前往小程序在线签约/报名试驾", action: "goto_mp_mine" }]
        });
        scrollOaBottom();
      } else if (code === "push_license") {
        oaMessages.value.push({
          id: Date.now(),
          sender: "oa",
          type: "license_card",
          time: nowTimeStr()
        });
        scrollOaBottom();
      } else if (code === "push_location") {
        oaMessages.value.push({
          id: Date.now(),
          sender: "oa",
          type: "location_card",
          time: nowTimeStr()
        });
        scrollOaBottom();
      }
    };

    // 用户在微信公众号内直接打字发送消息 -> 自动回复 + 同步至商家网页后台
    const sendOaUserMsg = (preset = null) => {
      const txt = (preset || oaUserInput.value).trim();
      if (!txt) return;
      oaMessages.value.push({
        id: Date.now(),
        sender: "user",
        type: "user_text",
        time: nowTimeStr(),
        content: txt
      });
      if (!preset) oaUserInput.value = "";

      // 同步到商家网页管理后台全渠道聊天坐席
      state.chatMessages.push({
        id: Date.now(),
        from: "user",
        channel: "微信公众号",
        senderName: "💬 微信公众号粉丝",
        time: nowTimeStr(),
        text: txt
      });
      persistAndSync(state);
      scrollOaBottom();

      setTimeout(() => {
        let replyTitle = "🤖 河北元赫公众号客服自动回复（已同步通知后台杨经理）：";
        let replyBody = `感谢您的留言！看车试驾请导航【${state.company.address}】，24h热线：${state.company.phone}（杨经理）。您也可以直接点击下方链接进入小程序选车或报名：`;
        if (txt.includes("营业执照") || txt.includes("资质")) {
          handleOaAction("push_license");
          return;
        }
        if (txt.includes("合同") || txt.includes("押金") || txt.includes("保险")) {
          handleOaAction("push_contract");
          return;
        }
        oaMessages.value.push({
          id: Date.now() + 1,
          sender: "oa",
          type: "welcome",
          time: nowTimeStr(),
          title: replyTitle,
          content: replyBody,
          links: [
            { label: "🚗 打开【元赫微信小程序】在线选车/查底价", action: "goto_mp_cars" },
            { label: "📝 打开【元赫微信小程序】提交看车预约", action: "goto_mp_mine" }
          ]
        });
        scrollOaBottom();
      }, 300);
    };

    const copyArticleText = (art) => {
      const temp = document.createElement("div");
      temp.innerHTML = art.content;
      const plain = `${art.title}\n\n${temp.innerText || temp.textContent}`;
      if (navigator.clipboard) navigator.clipboard.writeText(plain);
      showToast("✅ 推文正文已复制到剪贴板！");
    };

    // ==========================================
    // 商家端管理功能：手动上传车型四维图片 & 上传Logo & 增删改车型 (Requirement 1 & 5)
    // ==========================================
    const compressImageFile = (file, maxW = 960, maxH = 600, callback) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = maxW;
          canvas.height = maxH;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, maxW, maxH);
          const scale = Math.max(maxW / img.width, maxH / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, (maxW - w) / 2, (maxH - h) / 2, w, h);
          callback(canvas.toDataURL("image/jpeg", 0.86));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    };

    // 商家手动上传某款车的某个视角图片 (front | side | rear | interior)
    const uploadCarImage = (car, angleKey, event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      compressImageFile(file, 960, 600, (base64Url) => {
        car.images[angleKey] = base64Url;
        showToast(`📸 已成功上传并更新【${car.name}】的视图！消费者官网已实时同步`);
      });
    };

    // 商家手动上传替换品牌 Logo
    const uploadCompanyLogo = (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        state.company.logoUrl = e.target.result;
        showToast("✅ 品牌 Logo 已更新并同步至消费者官网！");
      };
      reader.readAsDataURL(file);
    };

    const newCarForm = reactive({
      name: "",
      brand: "比亚迪 / 埃安",
      category: "ride_hailing",
      isHot: true,
      unifiedColorName: "雪域白 · 统一展车",
      badge: "🔥 主推合规现车",
      seats: "5座三厢轿车",
      powerType: "纯电动 EV",
      rangeKm: 510,
      rentMonthly: 3200,
      leaseDownPayment: 10000,
      leaseMonthly: 3500,
      dailyRent: 168,
      stockStatus: "现车在库 · 当日可提",
      images: {
        front: "./assets/cars/qin_plus_front.jpg",
        side: "./assets/cars/qin_plus_side.jpg",
        rear: "./assets/cars/qin_plus_rear.jpg",
        interior: "./assets/cars/qin_plus_interior.jpg"
      }
    });

    const uploadNewCarImage = (angleKey, event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      compressImageFile(file, 960, 600, (base64Url) => {
        newCarForm.images[angleKey] = base64Url;
        showToast(`📸 新车型【${angleKey}】图片已就绪！`);
      });
    };

    const addNewVehicle = () => {
      if (!newCarForm.name.trim()) {
        showToast("请输入新车型名称（如：比亚迪海豚 / 埃安AION V）", "warn");
        return;
      }
      state.vehicles.unshift({
        id: "v_" + Date.now(),
        name: newCarForm.name.trim(),
        brand: newCarForm.brand.trim() || "严选新能源",
        category: newCarForm.category,
        isHot: newCarForm.isHot,
        hotRankText: "商家精选主推车型",
        monthlyOrders: 28,
        unifiedColorName: newCarForm.unifiedColorName,
        badge: newCarForm.badge.trim() || "🔥 合规网约现车",
        complianceTag: "双证合规营运现车",
        seats: newCarForm.seats,
        powerType: newCarForm.powerType,
        rangeKm: Number(newCarForm.rangeKm) || 510,
        realRangeNote: "支持纯租/以租代购/自驾短租",
        batteryInfo: "高效快充 · 含全套营运险与保养",
        costPerKm: "约 0.08元/公里",
        rentMonthly: Number(newCarForm.rentMonthly) || 3200,
        rentDeposit: 5000,
        leaseDownPayment: Number(newCarForm.leaseDownPayment) || 10000,
        leaseMonthly: Number(newCarForm.leaseMonthly) || 3500,
        leasePeriods: 36,
        dailyRent: Number(newCarForm.dailyRent) || 168,
        stockStatus: newCarForm.stockStatus,
        images: { ...newCarForm.images },
        highlights: [
          "双证合规营运资质，一口价透明合同零套路",
          "支持纯租、以租代购及政企长短租",
          "元赫司管1对1辅导跑单，享充电与维保配套保障"
        ]
      });
      newCarForm.name = "";
      showToast("✅ 新车型已发布！消费者官网与小程序已实时同步！");
    };

    const removeVehicle = (idx) => {
      if (state.vehicles.length <= 1) {
        showToast("至少保留一款主推车型", "warn");
        return;
      }
      state.vehicles.splice(idx, 1);
      showToast("已删除该车型，消费者端已同步更新");
    };

    const resetDefaultData = () => {
      const fresh = JSON.parse(JSON.stringify(window.YUANHE_DEFAULT_DATA));
      Object.assign(state, fresh);
      localStorage.removeItem(STORAGE_KEY);
      persistAndSync(state);
      showToast("已恢复出厂默认数据！");
    };

    // ==========================================
    // 滴滴官网级全屏城市智慧流光开场动画 (DiDi Mobility Intro)
    // ==========================================
    const introAnim = reactive({
      visible: true,
      leaving: false,
      progress: 0,
      countCap: 0,
      countFleet: 0,
      countYears: 0
    });

    let introTimer = null;
    let introRaf = null;

    const enterMainSite = () => {
      if (introAnim.leaving || !introAnim.visible) return;
      introAnim.leaving = true;
      if (introTimer) clearInterval(introTimer);
      setTimeout(() => {
        introAnim.visible = false;
        introAnim.leaving = false;
        if (introRaf) cancelAnimationFrame(introRaf);
      }, 820);
    };

    const initDidiCanvas = () => {
      const canvas = document.getElementById("didi-intro-canvas");
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      resize();

      // 生成城市动脉流光粒子与轨迹线（蓝/青/翠绿/琥珀金四色流光，模拟滴滴城市运力脉搏）
      const colors = ["#38bdf8", "#10b981", "#2563eb", "#f59e0b", "#2dd4bf"];
      const streams = Array.from({ length: 58 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 3.2,
        vy: -Math.random() * 2.8 - 0.8,
        len: Math.random() * 95 + 45,
        size: Math.random() * 2.4 + 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: Math.random() * 0.65 + 0.25
      }));

      const render = () => {
        if (!introAnim.visible) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const cx = canvas.width / 2;
        const cy = canvas.height * 0.42;

        // 中心智慧出行脉冲波纹
        const t = performance.now() * 0.0012;
        for (let i = 0; i < 3; i++) {
          const r = ((t + i * 0.8) % 2.4) * 190;
          const op = Math.max(0, 0.22 - r / 1900);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(56, 189, 248, ${op})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // 流光车流轨迹
        for (const s of streams) {
          s.x += s.vx;
          s.y += s.vy;
          if (s.y < -80 || s.x < -80 || s.x > canvas.width + 80) {
            s.x = Math.random() * canvas.width;
            s.y = canvas.height + 40;
          }
          const grad = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 18, s.y - s.vy * 18);
          grad.addColorStop(0, s.color);
          grad.addColorStop(1, "transparent");
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x - s.vx * (s.len / 4), s.y - s.vy * (s.len / 4));
          ctx.strokeStyle = grad;
          ctx.globalAlpha = s.alpha;
          ctx.lineWidth = s.size;
          ctx.lineCap = "round";
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(s.x, s.y, s.size * 1.15, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        introRaf = requestAnimationFrame(render);
      };
      render();
    };

    const startIntroSequence = () => {
      introAnim.visible = true;
      introAnim.leaving = false;
      introAnim.progress = 0;
      introAnim.countCap = 0;
      introAnim.countFleet = 0;
      introAnim.countYears = 0;

      nextTick(() => {
        initDidiCanvas();
      });

      if (introTimer) clearInterval(introTimer);
      introTimer = setInterval(() => {
        introAnim.progress = Math.min(100, introAnim.progress + 2.5);
        introAnim.countCap = Math.min(5800, Math.round((introAnim.progress / 100) * 5800));
        introAnim.countFleet = Math.min(1000, Math.round((introAnim.progress / 100) * 1000));
        introAnim.countYears = Math.min(9, Math.round((introAnim.progress / 100) * 9));
        if (introAnim.progress >= 100) {
          clearInterval(introTimer);
          setTimeout(() => {
            enterMainSite();
          }, 420);
        }
      }, 85);
    };

    const replayIntroAnim = () => {
      startIntroSequence();
    };

    const licenseModalOpen = ref(false);
    const contractModalOpen = ref(false);
    let serverSyncTimer = null;

    // 监听另一端（商家后台 <-> 消费者官网/小程序/公众号）的实时修改事件（支持跨域名/跨浏览器实时同步）
    onMounted(() => {
      // 解析 URL 参数实现独立端深链接直达
      try {
        const params = new URLSearchParams(window.location.search);
        const tabParam = params.get("tab");
        const pageParam = params.get("page");
        if (tabParam) {
          if (["home", "cars", "service", "chat", "mine"].includes(tabParam)) {
            mpTab.value = tabParam;
          }
          if (["fleet_mgr", "brand_mgr", "mp_mgr", "oa_mgr", "leads_mgr"].includes(tabParam)) {
            merchantTab.value = tabParam;
          }
        }
        if (pageParam && ["home", "fleet", "calc", "services", "trust"].includes(pageParam)) {
          webPage.value = pageParam;
          introAnim.visible = false;
        }
      } catch (e) {}

      if (document.getElementById("didi-intro-canvas") && introAnim.visible) {
        startIntroSequence();
      }
      const applyRemoteLeadsAndChat = (d) => {
        if (!d) return;
        const localLeadsJson = JSON.stringify(state.leads || []);
        const remoteLeadsJson = JSON.stringify(d.leads || []);
        const localChatJson = JSON.stringify(state.chatMessages || []);
        const remoteChatJson = JSON.stringify(d.chatMessages || []);
        if (
          (Array.isArray(d.leads) && d.leads.length > 0 && localLeadsJson !== remoteLeadsJson) ||
          (Array.isArray(d.chatMessages) && d.chatMessages.length > 0 && localChatJson !== remoteChatJson)
        ) {
          isRemoteUpdating = true;
          if (Array.isArray(d.leads) && d.leads.length > 0) state.leads = d.leads;
          if (Array.isArray(d.chatMessages) && d.chatMessages.length > 0) state.chatMessages = d.chatMessages;
          nextTick(() => {
            isRemoteUpdating = false;
          });
        }
      };

      const pullFromServer = () => {
        fetch("./api/data")
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then((d) => {
            if (d && d.version === "3.1") applyRemoteLeadsAndChat(d);
          })
          .catch(() => {
            // 当处于 24 小时云端永久网址 (GitHub Pages) 时，直接从云端数据库拉取最新线索与对话
            fetch(CLOUD_BIN_URL + "/latest", {
              headers: { "X-Master-Key": CLOUD_API_KEY }
            })
              .then((r) => r.json())
              .then((res) => {
                if (res && res.record) applyRemoteLeadsAndChat(res.record);
              })
              .catch(() => {});
          });
      };

      // 首次拉取完整数据（优先本地接口，云端永久网址自动降级至云端数据库）
      fetch("./api/data")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          if (d && d.version === "3.1" && Array.isArray(d.vehicles)) {
            isRemoteUpdating = true;
            Object.assign(state, d);
            if (!Array.isArray(state.chatMessages) || state.chatMessages.length === 0) {
              state.chatMessages = JSON.parse(JSON.stringify(window.YUANHE_DEFAULT_DATA.chatMessages || []));
            }
            nextTick(() => {
              isRemoteUpdating = false;
            });
          }
        })
        .catch(() => {
          fetch(CLOUD_BIN_URL + "/latest", {
            headers: { "X-Master-Key": CLOUD_API_KEY }
          })
            .then((r) => r.json())
            .then((res) => {
              if (res && res.record && Array.isArray(res.record.leads) && res.record.leads.length > 0) {
                applyRemoteLeadsAndChat(res.record);
              } else {
                persistAndSync(state);
              }
            })
            .catch(() => {});
        });

      // 每3秒自动同步最新客户预约线索与在线聊天消息（本机或24小时云端永久网址均可秒级同步）
      serverSyncTimer = setInterval(pullFromServer, 3000);

      if (syncChannel) {
        syncChannel.onmessage = (ev) => {
          try {
            const parsed = JSON.parse(ev.data);
            if (parsed && parsed.version === "3.1") {
              isRemoteUpdating = true;
              Object.assign(state, parsed);
              nextTick(() => {
                isRemoteUpdating = false;
              });
            }
          } catch (e) {}
        };
      }

      window.addEventListener("storage", (ev) => {
        if (ev.key === STORAGE_KEY && ev.newValue) {
          try {
            const parsed = JSON.parse(ev.newValue);
            if (parsed && parsed.version === "3.1") {
              isRemoteUpdating = true;
              Object.assign(state, parsed);
              nextTick(() => {
                isRemoteUpdating = false;
              });
            }
          } catch (e) {}
        }
      });
    });

    onUnmounted(() => {
      if (autoRotateTimer) clearInterval(autoRotateTimer);
      if (introTimer) clearInterval(introTimer);
      if (introRaf) cancelAnimationFrame(introRaf);
      if (serverSyncTimer) clearInterval(serverSyncTimer);
    });

    return {
      state,
      licenseModalOpen,
      contractModalOpen,
      introAnim,
      enterMainSite,
      replayIntroAnim,
      activePlatform,
      merchantTab,
      leadChannelFilter,
      mpLeadsList,
      webLeadsList,
      filteredMerchantLeads,
      filteredChatMessages,
      webNavItems,
      webPage,
      activeNavIndex,
      switchWebPage,
      toast,
      showToast,
      // 车型与3D展台
      webCarFilter,
      sortedVehicles,
      filteredWebVehicles,
      hotVehicles,
      toggleHotCar,
      cardViewAngles,
      getCardAngle,
      setCardAngle,
      stage3d,
      stageCar,
      selectStageCar,
      onStageMouseDown,
      onStageMouseMove,
      onStageMouseUp,
      // 任意两款车对比器
      compareIds,
      compareLeftAngle,
      compareRightAngle,
      compareLeftCar,
      compareRightCar,
      setAsCompare,
      // 收益测算 & 石家庄热力沙盘
      calc,
      calcResult,
      sjzHotspots,
      activeHotspotIdx,
      // 悬浮客服与双向实时对话
      consultWidget,
      sendConsultMsg,
      merchantReplyInput,
      sendMerchantReply,
      clearChatHistory,
      copyText,
      // 弹窗与线索提交/导出
      activeCarModal,
      modalAngle,
      openCarDetail,
      bookingModal,
      openBookingModal,
      submitBooking,
      exportLeadsCsv,
      // 小程序与公众号
      mpMode,
      mpTab,
      mpCarFilter,
      mpFilteredCars,
      mpRentPaid,
      mpCurrentKm,
      mpContractOpen,
      mpActiveCar,
      mpActiveCarAngle,
      openMpCarDetail,
      mpJoinForm,
      submitMpJoin,
      mpMaintForm,
      submitMpMaintenance,
      mpChatInput,
      sendMpConsultMsg,
      replyToLead,
      simulatePayRent,
      oaSubMenu,
      oaInputMode,
      oaUserInput,
      sendOaUserMsg,
      oaMessages,
      activeArticle,
      triggerFollowWelcome,
      pushTemplateMsg,
      handleOaAction,
      copyArticleText,
      // 商家管理与图片上传
      uploadCarImage,
      uploadCompanyLogo,
      newCarForm,
      uploadNewCarImage,
      addNewVehicle,
      removeVehicle,
      resetDefaultData
    };
  }
}).mount("#app");
