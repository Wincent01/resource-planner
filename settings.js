
var SETTINGS = {
    fileName: "schedule.json",
    unknownPeriodName: "Unnamed period",
    newRoleValue: {
        faculty: 850,
        postdoc: 340,
        phdstudent: 340,
        amanuens: 80,
        course: 500,
    },
    newTaskValue: {
        faculty: 340,
        postdoc: 100,
        phdstudent: 100,
        amanuens: 80,
        course: 80,
        other: 40,
    },
    valueToWidth: {
        base: 10,
        factor: 2,
        exponent: 0.75,
        minValue: 10,
        snapDelta: 5,
    },
    sizeDescriptor: {
        person: "%",
        course: " students",
    },
    valueDescriptor: {
        person: " h",
        course: " h",
    },
    calculation: {
        person: (role, period) => {
            const percent = period ? role.size[period] : sum(Object.values(role.size));
            if (percent) return Math.round(1700 * percent / 100);
        },
        course: (role, period) => {
            const students = period ? role.size[period] : sum(Object.values(role.size));
            if (students) return Math.round(160 + 6 * students);
        },
    },
};
